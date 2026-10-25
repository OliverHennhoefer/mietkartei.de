import { eq, getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { accounts, auditLog, documents, leases, properties, tasks } from './db/schema';
import { createDemoData } from './demo';
import { storeDocument } from './documents';
import { exportJson, type ExportData } from './export';
import { ensureCharges } from './ledger';
import { canRestore, restoreDocument, restoredTables, restoreExport } from './restore';
import { storageKey } from './storage';
import { contextA, contextB, memoryStorage, seedUnit, testDatabase } from './testing';

let source: Database;
let target: Database;

beforeEach(async () => {
	source = await testDatabase();
	target = await testDatabase();
});

async function collect(db: Database, accountId: string): Promise<ExportData> {
	let text = '';
	for await (const piece of exportJson(db, accountId)) text += piece;
	return JSON.parse(text) as ExportData;
}

/** The demo account with a document, in account a of the source database. */
async function seedSource() {
	const created = await createDemoData(source, contextA);
	if (!created.ok) throw new Error(created.reason);
	await source
		.update(accounts)
		.set({ landlordName: 'Erika Muster', iban: 'DE02120300000000202051' });
	const [property] = await source.select({ id: properties.id }).from(properties).limit(1);
	const stored = await storeDocument(
		source,
		contextA,
		{
			name: 'Mietvertrag.pdf',
			mimeType: 'application/pdf',
			bytes: new Uint8Array([1, 2, 3]),
			links: { propertyId: property.id }
		},
		{ storage: memoryStorage() }
	);
	if (!stored.ok) throw new Error(stored.reason);
	return { documentId: stored.id };
}

describe('restoreExport', () => {
	it('restores every row of the export, so exporting again gives the same rows', async () => {
		await seedSource();
		const exported = await collect(source, 'a');

		const result = await restoreExport(target, contextA, exported);
		expect(result).toMatchObject({ ok: true, documents: 1 });

		const again = await collect(target, 'a');
		for (const table of restoredTables) {
			const name = getTableName(table);
			const rows = again.tables[name];
			const expected = exported.tables[name];
			if (table === auditLog) {
				expect(rows.slice(0, -1), name).toEqual(expected);
				expect(rows.at(-1)).toMatchObject({ summary: 'Export eingespielt', userId: 'user-a' });
			} else {
				expect(rows, name).toEqual(expected);
			}
		}
		expect(again.tables.accounts[0]).toMatchObject({
			name: 'Konto A',
			landlordName: 'Erika Muster',
			iban: 'DE02120300000000202051'
		});
	});

	it('moves the rows into another account and gives the owner’s rows to the restoring owner', async () => {
		await seedSource();
		const exported = await collect(source, 'a');
		const ownerRows = exported.tables.audit_log.filter((row) => row.userId === 'user-a');
		expect(ownerRows.length).toBeGreaterThan(0);

		expect(await restoreExport(target, contextB, exported)).toMatchObject({ ok: true });

		const again = await collect(target, 'b');
		expect(again.tables.properties.map((row) => row.id)).toEqual(
			exported.tables.properties.map((row) => row.id)
		);
		for (const [name, rows] of Object.entries(again.tables)) {
			for (const row of rows) if ('accountId' in row) expect(row.accountId, name).toBe('b');
		}
		expect(again.tables.audit_log.filter((row) => row.userId === 'user-b')).toHaveLength(
			ownerRows.length + 1
		);
		const [document] = again.tables.documents;
		expect(document.storageKey).toBe(storageKey('b', String(document.id)));
		expect(document.uploadedBy).toBe('user-b');
		// Users of the old account do not come along.
		expect(again.tables.users.map((row) => row.id)).toEqual(['user-b']);
	});

	it('replaces what an empty account holds already, such as seeded categories and tasks', async () => {
		await seedSource();
		const exported = await collect(source, 'a');
		await target
			.insert(tasks)
			.values({ accountId: 'a', title: 'Alte Aufgabe', dueDate: '2025-01-01' });

		expect(await restoreExport(target, contextA, exported)).toMatchObject({ ok: true });
		const titles = (await target.select({ title: tasks.title }).from(tasks)).map((t) => t.title);
		expect(titles).not.toContain('Alte Aufgabe');
		expect(titles).toHaveLength(exported.tables.tasks.length);
	});

	it('inserts a row a table refers to before the rows that refer to it', async () => {
		await seedSource();
		const leaseIds = (await source.select({ id: leases.id }).from(leases)).map((row) => row.id);
		await ensureCharges(source, 'a', leaseIds, '2025-03');
		const exported = await collect(source, 'a');
		const [first, second] = exported.tables.rent_charges;
		// The reversal comes first in the file, before the charge it reverses.
		const reversal = { ...second, reversesChargeId: first.id };
		exported.tables.rent_charges = [
			reversal,
			...exported.tables.rent_charges.filter((row) => row !== second)
		];
		expect(await restoreExport(target, contextB, exported)).toMatchObject({ ok: true });
		const again = await collect(target, 'b');
		expect(again.tables.rent_charges).toContainEqual(
			expect.objectContaining({ id: second.id, reversesChargeId: first.id })
		);
	});

	it('refuses an account with properties or documents', async () => {
		await seedSource();
		const exported = await collect(source, 'a');
		await seedUnit(target, 'a');
		expect(await canRestore(target, 'a')).toBe(false);
		expect(await restoreExport(target, contextA, exported)).toEqual({
			ok: false,
			reason: 'not-empty'
		});
	});

	it('refuses what is not an export of this version', async () => {
		for (const data of [
			null,
			[],
			{ format: 'other', version: 1, tables: {} },
			{ format: 'mietkartei', version: 2, tables: { accounts: [{}] } },
			{ format: 'mietkartei', version: 1, tables: { accounts: [] } }
		]) {
			expect(await restoreExport(target, contextA, data)).toEqual({ ok: false, reason: 'invalid' });
		}
	});

	it('refuses references to rows outside the export, such as those of another account', async () => {
		await seedSource();
		const exported = await collect(source, 'a');
		const foreign = await seedUnit(target, 'b');
		const lease = exported.tables.leases[0];
		const cases: ((data: ExportData) => void)[] = [
			(data) =>
				data.tables.units.push({
					...data.tables.units[0],
					id: crypto.randomUUID(),
					propertyId: foreign.propertyId
				}),
			(data) => data.tables.lease_tenants.push({ leaseId: lease.id, tenantId: 'fremder-mieter' }),
			(data) => (data.tables.documents[0].id = '../b/fremdes-dokument')
		];
		for (const change of cases) {
			const data = structuredClone(exported);
			change(data);
			expect(await restoreExport(target, contextA, data)).toEqual({ ok: false, reason: 'invalid' });
		}
		expect(await target.select().from(properties).where(eq(properties.accountId, 'a'))).toEqual([]);
	});

	it('refuses more documents than an account may hold', async () => {
		await seedSource();
		const exported = await collect(source, 'a');
		exported.tables.documents[0].size = 2 * 1024 * 1024 * 1024;
		expect(await restoreExport(target, contextA, exported)).toEqual({ ok: false, reason: 'quota' });
	});

	it('leaves the account as it was when a row is refused', async () => {
		await seedSource();
		const exported = await collect(source, 'a');
		// Restoring into the same database: the ids exist already.
		expect(await restoreExport(source, contextB, exported)).toEqual({
			ok: false,
			reason: 'rejected'
		});
		expect(await source.select().from(properties).where(eq(properties.accountId, 'b'))).toEqual([]);
	});
});

describe('restoreDocument', () => {
	it('stores the file of a restored document once, with the recorded size', async () => {
		const { documentId } = await seedSource();
		await restoreExport(target, contextB, await collect(source, 'a'));
		const storage = memoryStorage();
		const bytes = new Uint8Array([1, 2, 3]);

		expect(
			await restoreDocument(target, 'b', documentId, new Uint8Array([1]), { storage })
		).toEqual({ ok: false, reason: 'size' });
		expect(await restoreDocument(target, 'a', documentId, bytes, { storage })).toEqual({
			ok: false,
			reason: 'unknown'
		});
		expect(await restoreDocument(target, 'b', documentId, bytes, { storage })).toEqual({
			ok: true
		});
		expect(storage.files.get(storageKey('b', documentId))).toEqual(bytes);
		expect(await restoreDocument(target, 'b', documentId, bytes, { storage })).toEqual({
			ok: false,
			reason: 'exists'
		});
		const [row] = await target.select().from(documents);
		expect(row.storageKey).toBe(storageKey('b', documentId));
	});
});
