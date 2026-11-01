import { and, eq, inArray } from 'drizzle-orm';
import { zipSync, type Zippable } from 'fflate';
import { formatDate, today } from '../dates';
import { periodLabel, type PropertyItem } from '../domain/statement';
import { formatCents } from '../money';
import type { Database } from './db';
import { selectInChunks } from './db/batch';
import { documents } from './db/schema';
import { renderReport, type Report } from './pdf';
import { getStatement } from './statements';
import { getStorage, type Storage } from './storage';

// The Belegpaket of a statement: one ZIP for the tenants' Belegeinsicht (§ 259 BGB) with an
// overview PDF and the documents attached to the allocable cost items, numbered like the
// overview. Non-allocable items stay out, the tenants have no claim to see them.

export const RECEIPTS_OVERVIEW = '00 Belegübersicht.pdf';

type ReceiptDocument = { id: string; name: string; storageKey: string; costItemId: string | null };

/**
 * The documents attached to the given cost items, by name. The ids go in chunks, so a statement
 * with many items stays within D1's limit of bound parameters.
 */
async function receiptDocuments(
	db: Database,
	accountId: string,
	itemIds: string[]
): Promise<ReceiptDocument[]> {
	const rows = await selectInChunks(itemIds, (group) =>
		db
			.select({
				id: documents.id,
				name: documents.name,
				storageKey: documents.storageKey,
				costItemId: documents.costItemId
			})
			.from(documents)
			.where(and(eq(documents.accountId, accountId), inArray(documents.costItemId, group)))
	);
	return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}

const allocableIds = (items: readonly PropertyItem[]) =>
	items.filter((item) => item.allocable).map((item) => item.itemId);

/** How many documents the Belegpaket of these items holds. */
export async function receiptCount(
	db: Database,
	accountId: string,
	items: readonly PropertyItem[]
): Promise<number> {
	return (await receiptDocuments(db, accountId, allocableIds(items))).length;
}

/** A file name for every system: path separators and reserved characters become underscores. */
function safeName(name: string): string {
	return (
		Array.from(name, (char) =>
			char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char
		)
			.join('')
			.trim() || 'Beleg'
	);
}

export type ReceiptPackage = {
	filename: string;
	bytes: Uint8Array;
	/** Documents in the ZIP. */
	files: number;
	/** Documents whose file is gone from storage; the overview names them. */
	missing: number;
};

/**
 * The Belegpaket of a statement, draft or approved, built in memory: the overview first, then
 * `01 Grundsteuer - Bescheid.pdf` and so on, one number per cost item as in the overview, with
 * `-2`, `-3` for further documents of the same item. Undefined when the statement is not in the
 * account.
 */
export async function receiptPackage(
	db: Database,
	accountId: string,
	statementId: string,
	options: { storage?: Storage } = {}
): Promise<ReceiptPackage | undefined> {
	const view = await getStatement(db, accountId, statementId);
	if (!view) return undefined;
	const items = view.result.property.items.filter((item) => item.allocable);
	const rows = await receiptDocuments(db, accountId, allocableIds(items));
	// Opened on the first document, so a package without documents needs no storage.
	let storage = options.storage;

	// The overview comes first in the ZIP; its bytes are filled in once the table is known.
	const files: Zippable = { [RECEIPTS_OVERVIEW]: new Uint8Array(0) };
	const tableRows: string[][] = [];
	let count = 0;
	let missing = 0;
	for (const [index, item] of items.entries()) {
		const number = String(index + 1).padStart(2, '0');
		const own = rows.filter((row) => row.costItemId === item.itemId);
		const names: string[] = [];
		for (const [position, document] of own.entries()) {
			storage ??= await getStorage();
			const object = await storage.get(document.storageKey);
			if (!object) {
				missing++;
				names.push(`${document.name} (Datei fehlt)`);
				continue;
			}
			const suffix = position > 0 ? `-${position + 1}` : '';
			const path = `${number}${suffix} ${safeName(item.categoryName)} - ${safeName(document.name)}`;
			// Documents are mostly PDFs and photos, already compressed: stored, not deflated.
			files[path] = [new Uint8Array(await new Response(object.body).arrayBuffer()), { level: 0 }];
			names.push(document.name);
			count++;
		}
		tableRows.push([
			number,
			item.description,
			item.categoryName,
			formatCents(item.total),
			names.length > 0 ? names.join('\n') : 'kein Beleg hinterlegt'
		]);
	}

	const label = periodLabel(view.statement.periodStart, view.statement.periodEnd);
	const draft = view.statement.status === 'draft';
	const report: Report = {
		title: `Belegübersicht zur Betriebskostenabrechnung ${label}`,
		subtitle: [
			view.property.name,
			`Zeitraum ${formatDate(view.statement.periodStart)} – ${formatDate(view.statement.periodEnd)}` +
				(draft ? ' · Entwurf' : ''),
			`Stand ${formatDate(today())}`
		],
		blocks: [
			{
				paragraph:
					'Diese Übersicht nennt jede umgelegte Kostenart der Abrechnung mit ihrem Beleg. Die Nummer vorn ist auch der Anfang des Dateinamens in diesem Paket.'
			},
			{
				table: {
					columns: [
						{ label: 'Nr.', width: 0.06 },
						{ label: 'Beleg', width: 0.3 },
						{ label: 'Kostenart', width: 0.26 },
						{ label: 'Kosten', align: 'right', width: 0.13 },
						{ label: 'Datei' }
					],
					rows: tableRows,
					footer: [
						'',
						'Summe',
						'',
						formatCents(items.reduce((sum, item) => sum + item.total, 0)),
						''
					]
				}
			},
			...(missing > 0
				? [
						{
							paragraph:
								missing === 1
									? 'Zu einem Beleg fehlt die Datei im Speicher; er ist nicht in diesem Paket.'
									: `Zu ${missing} Belegen fehlt die Datei im Speicher; sie sind nicht in diesem Paket.`
						}
					]
				: [])
		]
	};
	files[RECEIPTS_OVERVIEW] = [await renderReport(report), { level: 0 }];

	return {
		filename: `Belege Betriebskostenabrechnung ${label} ${safeName(view.property.name)}.zip`,
		bytes: zipSync(files),
		files: count,
		missing
	};
}
