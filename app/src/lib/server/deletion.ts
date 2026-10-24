import { and, asc, count, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { formatDate } from '../dates';
import { personName, pluralize } from '../format';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunkIds, runBatch } from './db/batch';
import {
	allocationKeyShares,
	costItemUnitAmounts,
	costItems,
	depositTransactions,
	documents,
	expenses,
	insurancePolicies,
	leaseTenants,
	leaseUnits,
	leases,
	matchingRules,
	meterReadings,
	meters,
	operatingCostStatements,
	payments,
	paymentReminders,
	properties,
	rentCharges,
	statementResults,
	tasks,
	tenants,
	units
} from './db/schema';
import { deleteDocument } from './documents';
import type { Storage } from './storage';

// What deleting a tenant, property, unit or lease takes along and what blocks it, and the deletes
// themselves. The pages show the same check before anyone clicks, and the delete runs it again,
// so a refusal never depends on the page. The rules:
// - Anything with history stays: a lease blocks its tenants, units and property; payments,
//   deposit movements, postings and approved statements block their lease (it is ended instead);
//   expenses block their unit and property, because they are money already spent.
// - What only exists for the deleted record goes with it (database cascade): units, meters with
//   readings, keys, circles, cost items and statement drafts of a property; charges, rules and
//   reminders of a lease.
// - Documents lose the link (set null in the schema); one left without any link would be found by
//   nobody, so it is deleted with its file. Tasks keep their text and lose the link.

export type DeletionLink = { href: string; label: string };

/** Why the record cannot be deleted, and where to go to change that. */
export type DeletionBlocker = { text: string; links: DeletionLink[] };

export type DeletionCheck = {
	blockers: DeletionBlocker[];
	/** What goes with the record, e.g. "3 Einheiten"; empty when nothing does. */
	removes: string[];
	/** What stays but loses its link, e.g. "2 Aufgaben verlieren die Verknüpfung". */
	unlinks: string[];
};

type DocumentLinkIds = {
	propertyIds?: string[];
	unitIds?: string[];
	leaseIds?: string[];
	tenantIds?: string[];
	costItemIds?: string[];
};

const documentLinkColumns = {
	propertyIds: documents.propertyId,
	unitIds: documents.unitId,
	leaseIds: documents.leaseId,
	tenantIds: documents.tenantId,
	costItemIds: documents.costItemId
} as const;

const documentLinkFields = {
	propertyIds: 'propertyId',
	unitIds: 'unitId',
	leaseIds: 'leaseId',
	tenantIds: 'tenantId',
	costItemIds: 'costItemId'
} as const;

/** The documents linked to the deleted records whose every link points at a deleted record. */
async function orphanedDocuments(
	db: Database,
	accountId: string,
	deleted: DocumentLinkIds
): Promise<string[]> {
	const found = new Map<string, typeof documents.$inferSelect>();
	for (const key of Object.keys(documentLinkColumns) as (keyof DocumentLinkIds)[]) {
		for (const ids of chunkIds(deleted[key] ?? [])) {
			const rows = await db
				.select()
				.from(documents)
				.where(and(eq(documents.accountId, accountId), inArray(documentLinkColumns[key], ids)));
			for (const row of rows) found.set(row.id, row);
		}
	}
	const sets = Object.fromEntries(
		Object.entries(documentLinkFields).map(([key]) => [
			key,
			new Set(deleted[key as keyof DocumentLinkIds] ?? [])
		])
	) as Record<keyof DocumentLinkIds, Set<string>>;
	return [...found.values()]
		.filter((row) =>
			(Object.keys(documentLinkFields) as (keyof DocumentLinkIds)[]).every((key) => {
				const value = row[documentLinkFields[key]];
				return value === null || sets[key].has(value);
			})
		)
		.map((row) => row.id);
}

async function deleteDocuments(
	db: Database,
	context: AuditContext,
	ids: string[],
	storage: Storage | undefined
): Promise<void> {
	for (const id of ids) await deleteDocument(db, context, id, { storage });
}

async function countRows(
	db: Database,
	table: SQLiteTable,
	where: SQL | undefined
): Promise<number> {
	const [row] = await db.select({ value: count() }).from(table).where(where);
	return row.value;
}

/** Counts over a list of ids, in groups (D1 binds at most 100 parameters). */
async function countIn(
	db: Database,
	table: SQLiteTable,
	column: SQLiteColumn,
	ids: string[],
	extra?: SQL
): Promise<number> {
	let total = 0;
	for (const group of chunkIds(ids))
		total += await countRows(db, table, and(inArray(column, group), extra));
	return total;
}

function leaseLink(row: {
	id: string;
	unitName: string;
	propertyName: string;
	startDate: string;
	endDate: string | null;
	tenantNames: string[];
}): DeletionLink {
	const period = row.endDate
		? `${formatDate(row.startDate)} bis ${formatDate(row.endDate)}`
		: `seit ${formatDate(row.startDate)}`;
	return {
		href: `/vertraege/${row.id}`,
		label: `${row.unitName} · ${row.propertyName}: ${row.tenantNames.length > 0 ? row.tenantNames.join(', ') : 'ohne Mieter'}, ${period}`
	};
}

/** The leases that use one of the units, as main or extra unit, with their labels. */
async function leasesOnUnits(
	db: Database,
	accountId: string,
	unitIds: string[]
): Promise<DeletionLink[]> {
	const leaseIds = new Set<string>();
	for (const ids of chunkIds(unitIds)) {
		const [main, extra] = await Promise.all([
			db
				.select({ id: leases.id })
				.from(leases)
				.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, ids))),
			db
				.select({ id: leaseUnits.leaseId })
				.from(leaseUnits)
				.where(and(eq(leaseUnits.accountId, accountId), inArray(leaseUnits.unitId, ids)))
		]);
		for (const row of [...main, ...extra]) leaseIds.add(row.id);
	}
	return leaseLinks(db, accountId, [...leaseIds]);
}

/** The leases as links to their pages, labelled with unit, property, tenants and period. */
export async function leaseLinks(
	db: Database,
	accountId: string,
	leaseIds: string[]
): Promise<DeletionLink[]> {
	return (await leaseRows(db, accountId, leaseIds)).map(leaseLink);
}

/** The leases with their unit and property names, latest start first. */
async function leaseRows(db: Database, accountId: string, leaseIds: string[]) {
	const rows = [];
	for (const ids of chunkIds(leaseIds)) {
		rows.push(
			...(await db
				.select({
					id: leases.id,
					unitName: units.name,
					propertyName: properties.name,
					startDate: leases.startDate,
					endDate: leases.endDate
				})
				.from(leases)
				.innerJoin(units, eq(units.id, leases.unitId))
				.innerJoin(properties, eq(properties.id, units.propertyId))
				.where(and(eq(leases.accountId, accountId), inArray(leases.id, ids))))
		);
	}
	const names = new Map<string, string[]>();
	for (const ids of chunkIds(leaseIds)) {
		const tenantRows = await db
			.select({
				leaseId: leaseTenants.leaseId,
				firstName: tenants.firstName,
				lastName: tenants.lastName
			})
			.from(leaseTenants)
			.innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
			.where(and(eq(tenants.accountId, accountId), inArray(leaseTenants.leaseId, ids)))
			.orderBy(asc(tenants.lastName), asc(tenants.firstName));
		for (const row of tenantRows) {
			names.set(row.leaseId, [...(names.get(row.leaseId) ?? []), personName(row)]);
		}
	}
	rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
	return rows.map((row) => ({ ...row, tenantNames: names.get(row.id) ?? [] }));
}

function documentsLine(ids: string[]): string[] {
	return ids.length === 0
		? []
		: [`${pluralize(ids.length, 'Dokument', 'Dokumente')} ohne andere Zuordnung`];
}

function line(value: number, singular: string, plural: string, suffix = ''): string[] {
	return value === 0 ? [] : [`${pluralize(value, singular, plural)}${suffix}`];
}

// Tenants

export async function tenantDeletion(
	db: Database,
	accountId: string,
	tenantId: string
): Promise<DeletionCheck> {
	const leaseRows = await db
		.select({ id: leaseTenants.leaseId })
		.from(leaseTenants)
		.innerJoin(leases, eq(leases.id, leaseTenants.leaseId))
		.where(and(eq(leases.accountId, accountId), eq(leaseTenants.tenantId, tenantId)));
	const blockers: DeletionBlocker[] = [];
	if (leaseRows.length > 0) {
		blockers.push({
			text: `Der Mieter steht auf ${leaseRows.length === 1 ? 'einem Mietvertrag' : `${pluralize(leaseRows.length, 'Mietvertrag', 'Mietverträgen')}`}, auch beendete Verträge zählen: Sie sind die Historie mit Mietkonto und Kaution. Nimm den Mieter im Vertrag unter „Bearbeiten“ heraus, oder lösche einen Vertrag ohne Buchungen auf seiner Seite.`,
			links: await leaseLinks(
				db,
				accountId,
				leaseRows.map((row) => row.id)
			)
		});
	}
	const orphaned = await orphanedDocuments(db, accountId, { tenantIds: [tenantId] });
	return { blockers, removes: documentsLine(orphaned), unlinks: [] };
}

/** A tenant on a lease, ended ones too, stays; the leases keep the history. */
export async function deleteTenant(
	db: Database,
	context: AuditContext,
	tenantId: string,
	options?: { storage?: Storage }
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const [existing] = await db
		.select()
		.from(tenants)
		.where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId)));
	if (!existing) return 'missing';
	if ((await tenantDeletion(db, accountId, tenantId)).blockers.length > 0) return 'in-use';
	const orphaned = await orphanedDocuments(db, accountId, { tenantIds: [tenantId] });
	await runBatch(db, [
		db.delete(tenants).where(and(eq(tenants.accountId, accountId), eq(tenants.id, tenantId))),
		auditEntry(db, context, 'tenant', tenantId, 'delete', `Mieter ${personName(existing)} gelöscht`)
	]);
	await deleteDocuments(db, context, orphaned, options?.storage);
	return 'deleted';
}

// Properties and units

async function unitIdsOf(db: Database, accountId: string, propertyId: string): Promise<string[]> {
	const rows = await db
		.select({ id: units.id })
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)))
		.orderBy(asc(units.name));
	return rows.map((row) => row.id);
}

async function costItemIdsOf(
	db: Database,
	accountId: string,
	propertyId: string
): Promise<string[]> {
	const rows = await db
		.select({ id: costItems.id })
		.from(costItems)
		.where(and(eq(costItems.accountId, accountId), eq(costItems.propertyId, propertyId)));
	return rows.map((row) => row.id);
}

function leasesBlocker(links: DeletionLink[], what: string): DeletionBlocker[] {
	if (links.length === 0) return [];
	return [
		{
			text: `Auf ${what} ${links.length === 1 ? 'liegt ein Mietvertrag' : `liegen ${pluralize(links.length, 'Mietvertrag', 'Mietverträge')}`}, auch beendete zählen: Sie bleiben mit Mietkonto und Kaution erhalten. Einen Vertrag ohne Buchungen kannst du auf seiner Seite löschen; laufende Verträge beendest du dort mit „Vertrag beenden“.`,
			links
		}
	];
}

function expensesBlocker(value: number, what: string): DeletionBlocker[] {
	if (value === 0) return [];
	return [
		{
			text: `Auf ${what} ${value === 1 ? 'ist eine Ausgabe' : `sind ${pluralize(value, 'Ausgabe', 'Ausgaben')}`} gebucht. Ausgaben sind bezahltes Geld und gehören in die Auswertung; lösche oder verschiebe sie zuerst.`,
			links: [{ href: '/auswertung/ausgaben', label: 'Ausgaben' }]
		}
	];
}

async function meterLines(db: Database, accountId: string, where: SQL): Promise<string[]> {
	const meterRows = await db
		.select({ id: meters.id })
		.from(meters)
		.where(and(eq(meters.accountId, accountId), where));
	const readings = await countIn(
		db,
		meterReadings,
		meterReadings.meterId,
		meterRows.map((row) => row.id)
	);
	return line(
		meterRows.length,
		'Zähler',
		'Zähler',
		readings > 0 ? ` mit ${pluralize(readings, 'Ablesung', 'Ablesungen')}` : ''
	);
}

export async function propertyDeletion(
	db: Database,
	accountId: string,
	propertyId: string
): Promise<DeletionCheck> {
	const unitIds = await unitIdsOf(db, accountId, propertyId);
	const costItemIds = await costItemIdsOf(db, accountId, propertyId);
	const ofProperty = (column: SQLiteColumn) => and(eq(column, propertyId));
	const [leaseList, expenseCount, statementCount, policyCount, taskCount, meterLine, orphaned] =
		await Promise.all([
			leasesOnUnits(db, accountId, unitIds),
			countRows(
				db,
				expenses,
				and(eq(expenses.accountId, accountId), eq(expenses.propertyId, propertyId))
			).then(
				async (direct) =>
					direct +
					(await countIn(
						db,
						expenses,
						expenses.unitId,
						unitIds,
						ne(expenses.propertyId, propertyId)
					))
			),
			countRows(
				db,
				operatingCostStatements,
				and(
					eq(operatingCostStatements.accountId, accountId),
					ofProperty(operatingCostStatements.propertyId)
				)
			),
			countRows(
				db,
				insurancePolicies,
				and(eq(insurancePolicies.accountId, accountId), ofProperty(insurancePolicies.propertyId))
			),
			countRows(db, tasks, and(eq(tasks.accountId, accountId), ofProperty(tasks.propertyId))),
			meterLines(db, accountId, eq(meters.propertyId, propertyId)),
			orphanedDocuments(db, accountId, { propertyIds: [propertyId], unitIds, costItemIds })
		]);
	return {
		blockers: [
			...leasesBlocker(leaseList, 'den Einheiten des Objekts'),
			...expensesBlocker(expenseCount, 'das Objekt')
		],
		removes: [
			...line(unitIds.length, 'Einheit', 'Einheiten'),
			...meterLine,
			...line(costItemIds.length, 'Beleg', 'Belege'),
			...line(
				statementCount,
				'Betriebskostenabrechnung',
				'Betriebskostenabrechnungen',
				' (Entwürfe)'
			),
			...line(policyCount, 'Versicherung', 'Versicherungen'),
			...documentsLine(orphaned),
			'die Umlageschlüssel und Abrechnungskreise des Objekts'
		],
		unlinks: line(taskCount, 'Aufgabe bleibt', 'Aufgaben bleiben', ' ohne Verknüpfung')
	};
}

/**
 * Deletes the property with its units, meters, keys, circles, cost items and statement drafts
 * (database cascade), and the documents left without any link. Refused while a lease or an
 * expense is on it; see propertyDeletion.
 */
export async function deleteProperty(
	db: Database,
	context: AuditContext,
	propertyId: string,
	options?: { storage?: Storage }
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const [existing] = await db
		.select()
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!existing) return 'missing';
	if ((await propertyDeletion(db, accountId, propertyId)).blockers.length > 0) return 'in-use';
	const orphaned = await orphanedDocuments(db, accountId, {
		propertyIds: [propertyId],
		unitIds: await unitIdsOf(db, accountId, propertyId),
		costItemIds: await costItemIdsOf(db, accountId, propertyId)
	});
	await runBatch(db, [
		db
			.delete(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		auditEntry(db, context, 'property', propertyId, 'delete', `Objekt ${existing.name} gelöscht`)
	]);
	await deleteDocuments(db, context, orphaned, options?.storage);
	return 'deleted';
}

export async function unitDeletion(
	db: Database,
	accountId: string,
	unitId: string
): Promise<DeletionCheck> {
	const [leaseList, expenseCount, directItems, shareCount, meterLine, orphaned] = await Promise.all(
		[
			leasesOnUnits(db, accountId, [unitId]),
			countRows(db, expenses, and(eq(expenses.accountId, accountId), eq(expenses.unitId, unitId))),
			db
				.selectDistinct({ id: costItems.id, description: costItems.description })
				.from(costItemUnitAmounts)
				.innerJoin(costItems, eq(costItems.id, costItemUnitAmounts.costItemId))
				.where(
					and(eq(costItemUnitAmounts.accountId, accountId), eq(costItemUnitAmounts.unitId, unitId))
				)
				.orderBy(asc(costItems.description)),
			countRows(
				db,
				allocationKeyShares,
				and(eq(allocationKeyShares.accountId, accountId), eq(allocationKeyShares.unitId, unitId))
			),
			meterLines(db, accountId, eq(meters.unitId, unitId)),
			orphanedDocuments(db, accountId, { unitIds: [unitId] })
		]
	);
	const blockers = [
		...leasesBlocker(leaseList, 'der Einheit'),
		...expensesBlocker(expenseCount, 'die Einheit')
	];
	if (directItems.length > 0) {
		blockers.push({
			text: `${directItems.length === 1 ? 'Ein Beleg verteilt' : `${pluralize(directItems.length, 'Beleg', 'Belege')} verteilen`} Beträge direkt auf diese Einheit. Ohne die Einheit ginge die Summe nicht mehr auf; ändere zuerst die Verteilung.`,
			links: directItems.map((item) => ({
				href: `/betriebskosten/belege/${item.id}`,
				label: item.description
			}))
		});
	}
	return {
		blockers,
		removes: [
			...meterLine,
			...line(shareCount, 'Anteil in einem Umlageschlüssel', 'Anteile in Umlageschlüsseln'),
			...documentsLine(orphaned)
		],
		unlinks: []
	};
}

/**
 * Deletes the unit with its meters, key shares and circle links (database cascade), and the
 * documents left without any link. Refused while a lease, an expense or a direct amount is on it.
 */
export async function deleteUnit(
	db: Database,
	context: AuditContext,
	unitId: string,
	options?: { storage?: Storage }
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const [existing] = await db
		.select({ name: units.name, propertyName: properties.name })
		.from(units)
		.innerJoin(properties, eq(properties.id, units.propertyId))
		.where(and(eq(units.accountId, accountId), eq(units.id, unitId)));
	if (!existing) return 'missing';
	if ((await unitDeletion(db, accountId, unitId)).blockers.length > 0) return 'in-use';
	const orphaned = await orphanedDocuments(db, accountId, { unitIds: [unitId] });
	await runBatch(db, [
		db.delete(units).where(and(eq(units.accountId, accountId), eq(units.id, unitId))),
		auditEntry(
			db,
			context,
			'unit',
			unitId,
			'delete',
			`Einheit ${existing.name} in ${existing.propertyName} gelöscht`
		)
	]);
	await deleteDocuments(db, context, orphaned, options?.storage);
	return 'deleted';
}

// Leases

export async function leaseDeletion(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<DeletionCheck> {
	const ofLease = <T extends { accountId: SQLiteColumn; leaseId: SQLiteColumn }>(table: T) =>
		and(eq(table.accountId, accountId), eq(table.leaseId, leaseId));
	const [paid, deposit, posted, settled, reminded, rentRows, rules, taskCount, orphaned] =
		await Promise.all([
			countRows(db, payments, ofLease(payments)),
			countRows(db, depositTransactions, ofLease(depositTransactions)),
			countRows(db, rentCharges, and(ofLease(rentCharges), ne(rentCharges.kind, 'rent'))),
			countRows(db, statementResults, ofLease(statementResults)),
			countRows(db, paymentReminders, ofLease(paymentReminders)),
			countRows(db, rentCharges, and(ofLease(rentCharges), eq(rentCharges.kind, 'rent'))),
			countRows(db, matchingRules, ofLease(matchingRules)),
			countRows(db, tasks, and(eq(tasks.accountId, accountId), eq(tasks.leaseId, leaseId))),
			orphanedDocuments(db, accountId, { leaseIds: [leaseId] })
		]);
	const history = [
		...line(paid, 'Zahlung', 'Zahlungen'),
		...line(deposit, 'Kautionsbewegung', 'Kautionsbewegungen'),
		...line(posted, 'Buchung', 'Buchungen', ' außer der Monatsmiete'),
		...line(settled, 'Betriebskostenabrechnung', 'Betriebskostenabrechnungen'),
		...line(reminded, 'Mahnung', 'Mahnungen')
	];
	const blockers: DeletionBlocker[] =
		history.length === 0
			? []
			: [
					{
						text: `Auf dem Vertrag ist schon gebucht: ${history.join(', ')}. Damit die Historie bleibt, wird er nicht gelöscht, sondern mit „Vertrag beenden“ beendet.`,
						links: []
					}
				];
	return {
		blockers,
		removes: [
			...line(rentRows, 'Monatsmiete', 'Monatsmieten', ' im Mietkonto'),
			...line(rules, 'Regel', 'Regeln', ' für den Bankabgleich'),
			...documentsLine(orphaned)
		],
		unlinks: line(taskCount, 'Aufgabe bleibt', 'Aufgaben bleiben', ' ohne Verknüpfung')
	};
}

/**
 * Deletes the lease with its rent and persons history, generated rent charges and matching rules
 * (database cascade), and the documents left without any link. A lease with history (payments,
 * deposit movements, postings, statements, reminders) is ended instead; see leaseDeletion.
 */
export async function deleteLease(
	db: Database,
	context: AuditContext,
	leaseId: string,
	options?: { storage?: Storage }
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const [existing] = await leaseRows(db, accountId, [leaseId]);
	if (!existing) return 'missing';
	if ((await leaseDeletion(db, accountId, leaseId)).blockers.length > 0) return 'in-use';
	const orphaned = await orphanedDocuments(db, accountId, { leaseIds: [leaseId] });
	await runBatch(db, [
		db.delete(leases).where(and(eq(leases.accountId, accountId), eq(leases.id, leaseId))),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'delete',
			`Mietvertrag ${existing.unitName} · ${existing.propertyName} gelöscht`
		)
	]);
	await deleteDocuments(db, context, orphaned, options?.storage);
	return 'deleted';
}
