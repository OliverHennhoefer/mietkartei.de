import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteBankAccount, listBankAccounts } from './bank/accounts';
import type { Database } from './db';
import {
	costItemUnitAmounts,
	documents,
	expenses,
	leaseTenants,
	leases,
	paymentReminders,
	properties,
	tasks,
	tenants,
	units
} from './db/schema';
import {
	deleteLease,
	deleteProperty,
	deleteTenant,
	deleteUnit,
	leaseDeletion,
	propertyDeletion,
	tenantDeletion,
	unitDeletion
} from './deletion';
import { createDemoData } from './demo';
import { getDocument, storeDocument, type DocumentLinks } from './documents';
import { createPayment } from './ledger';
import {
	deleteCategory,
	deleteCostItem,
	deleteKey,
	listCategories,
	listCostItems,
	listKeys
} from './operating-costs';
import { createTask, getTask } from './tasks';
import {
	contextA,
	contextB,
	integrityProblems,
	memoryStorage,
	seedCostItem,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from './testing';

let db: Database;
let storage: ReturnType<typeof memoryStorage>;

beforeEach(async () => {
	db = await testDatabase();
	storage = memoryStorage();
});

async function store(links: DocumentLinks): Promise<string> {
	const stored = await storeDocument(
		db,
		contextA,
		{ name: 'Datei.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]), links },
		{ storage }
	);
	if (!stored.ok) throw new Error(stored.reason);
	return stored.id;
}

describe('tenants', () => {
	it('names the leases that keep a tenant, ended ones too', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a', { firstName: 'Erika', lastName: 'Muster' });
		const leaseId = await seedLease(db, 'a', unitId, {
			tenantIds: [tenantId],
			endDate: '2025-06-30'
		});
		const check = await tenantDeletion(db, 'a', tenantId);
		expect(check.blockers).toEqual([
			{
				text: expect.stringContaining('einem Mietvertrag'),
				links: [
					{
						href: `/vertraege/${leaseId}`,
						label: 'EG links · Haus: Erika Muster, 01.01.2025 bis 30.06.2025'
					}
				]
			}
		]);
		expect(await deleteTenant(db, contextA, tenantId)).toBe('in-use');
	});

	it('deletes the documents only the tenant had and unlinks the others', async () => {
		const { propertyId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a');
		const own = await store({ tenantId });
		const shared = await store({ tenantId, propertyId });
		expect(await tenantDeletion(db, 'a', tenantId)).toEqual({
			blockers: [],
			removes: ['1 Dokument ohne andere Zuordnung'],
			unlinks: []
		});
		expect(await deleteTenant(db, contextA, tenantId, { storage })).toBe('deleted');
		expect(await getDocument(db, 'a', own)).toBeUndefined();
		expect(storage.files.size).toBe(1);
		expect(await getDocument(db, 'a', shared)).toMatchObject({ tenantId: null, propertyId });
	});
});

describe('units and properties', () => {
	it('keeps a unit that a cost item splits its amount on directly', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const itemId = await seedCostItem(db, 'a', propertyId, { description: 'Wartung' });
		await db
			.insert(costItemUnitAmounts)
			.values({ accountId: 'a', costItemId: itemId, unitId, amount: 100 });
		expect((await unitDeletion(db, 'a', unitId)).blockers).toEqual([
			{
				text: expect.stringContaining('direkt auf diese Einheit'),
				links: [{ href: `/betriebskosten/belege/${itemId}`, label: 'Wartung' }]
			}
		]);
		expect(await deleteUnit(db, contextA, unitId)).toBe('in-use');
	});

	it('keeps a unit and property that another lease uses as an extra unit', async () => {
		const main = await seedUnit(db, 'a', { propertyName: 'Haupthaus' });
		const parking = await seedUnit(db, 'a', { name: 'Stellplatz', propertyName: 'Hof' });
		await seedLease(db, 'a', main.unitId, { extraUnitIds: [parking.unitId] });
		expect(await deleteUnit(db, contextA, parking.unitId)).toBe('in-use');
		expect(await deleteProperty(db, contextA, parking.propertyId)).toBe('in-use');
		expect((await propertyDeletion(db, 'a', parking.propertyId)).blockers[0].links).toHaveLength(1);
	});

	it('lists what goes with a property and takes its receipts along', async () => {
		const { propertyId, unitId } = await seedUnit(db, 'a');
		const itemId = await seedCostItem(db, 'a', propertyId);
		const receipt = await store({ costItemId: itemId, propertyId });
		const unitDocument = await store({ unitId });
		const general = await store({});
		const task = await createTask(db, contextA, {
			title: 'Dach prüfen',
			category: 'maintenance',
			dueDate: null,
			repeatMonths: null,
			propertyId,
			leaseId: null,
			note: null
		});
		if (!task.ok) throw new Error(task.reason);
		const check = await propertyDeletion(db, 'a', propertyId);
		expect(check.blockers).toEqual([]);
		expect(check.removes).toEqual([
			'1 Einheit',
			'1 Beleg',
			'2 Dokumente ohne andere Zuordnung',
			'die Umlageschlüssel und Abrechnungskreise des Objekts'
		]);
		expect(check.unlinks).toEqual(['1 Aufgabe bleibt ohne Verknüpfung']);
		expect(await deleteProperty(db, contextA, propertyId, { storage })).toBe('deleted');
		expect(await getDocument(db, 'a', receipt)).toBeUndefined();
		expect(await getDocument(db, 'a', unitDocument)).toBeUndefined();
		expect(await getDocument(db, 'a', general)).toBeDefined();
		expect(await getTask(db, 'a', task.id)).toMatchObject({ propertyId: null });
		expect(await integrityProblems(db)).toEqual([]);
	});
});

describe('leases', () => {
	it('keeps a lease with a reminder letter or a payment, and says what to do', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const leaseId = await seedLease(db, 'a', unitId);
		await db.insert(paymentReminders).values({
			accountId: 'a',
			leaseId,
			level: 1,
			date: '2025-03-10',
			paymentDeadline: '2025-03-24',
			amount: 80000,
			items: [],
			letterText: ''
		});
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-03-12',
			amount: 1000,
			source: 'manual',
			note: null
		});
		const [blocker] = (await leaseDeletion(db, 'a', leaseId)).blockers;
		expect(blocker.text).toContain('1 Zahlung, 1 Mahnung');
		expect(blocker.text).toContain('Vertrag beenden');
		expect(await deleteLease(db, contextA, leaseId)).toBe('in-use');
	});

	it('deletes a lease without history with its rent rows and own documents', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a');
		const leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
		const contract = await store({ leaseId });
		const withTenant = await store({ leaseId, tenantId });
		const check = await leaseDeletion(db, 'a', leaseId);
		expect(check.blockers).toEqual([]);
		expect(check.removes).toContain('1 Dokument ohne andere Zuordnung');
		expect(await deleteLease(db, contextA, leaseId, { storage })).toBe('deleted');
		expect(await getDocument(db, 'a', contract)).toBeUndefined();
		expect(await getDocument(db, 'a', withTenant)).toMatchObject({ leaseId: null, tenantId });
		expect(await db.select().from(leaseTenants)).toEqual([]);
		expect(await deleteTenant(db, contextA, tenantId, { storage })).toBe('deleted');
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('does not see or delete records of another account', async () => {
		const { unitId } = await seedUnit(db, 'b');
		const leaseId = await seedLease(db, 'b', unitId);
		expect(await deleteLease(db, contextA, leaseId)).toBe('missing');
		expect(await deleteUnit(db, contextA, unitId)).toBe('missing');
		expect(await deleteLease(db, contextB, leaseId)).toBe('deleted');
	});
});

describe('integrity', () => {
	it('stays intact whatever is deleted, in any order', async () => {
		await createDemoData(db, contextA);
		await createDemoData(db, contextB);
		expect(await integrityProblems(db)).toEqual([]);
		const before = await db.select().from(leases).where(eq(leases.accountId, 'b'));

		// Everything that can go goes, the rest is refused; nothing may throw or break a reference.
		for (let round = 0; round < 2; round++) {
			const ids = async (
				table: typeof tenants | typeof units | typeof properties | typeof leases
			) =>
				(await db.select({ id: table.id }).from(table).where(eq(table.accountId, 'a'))).map(
					(row) => row.id
				);
			for (const id of await ids(tenants)) await deleteTenant(db, contextA, id, { storage });
			for (const id of await ids(units)) await deleteUnit(db, contextA, id, { storage });
			for (const id of await ids(leases)) await deleteLease(db, contextA, id, { storage });
			for (const id of await ids(properties)) await deleteProperty(db, contextA, id, { storage });
			for (const item of await listCostItems(db, 'a')) {
				await deleteCostItem(db, contextA, item.id, { storage });
			}
			for (const category of await listCategories(db, 'a')) {
				await deleteCategory(db, contextA, category.id);
			}
			for (const key of await listKeys(db, 'a')) await deleteKey(db, contextA, key.id);
			for (const account of await listBankAccounts(db, 'a')) {
				await deleteBankAccount(db, contextA, account.id);
			}
			expect(await integrityProblems(db)).toEqual([]);
		}

		// Leases with payments keep their tenants, units and properties; expenses keep theirs.
		expect(await db.select().from(leases).where(eq(leases.accountId, 'a'))).not.toEqual([]);
		expect(await db.select().from(properties).where(eq(properties.accountId, 'a'))).not.toEqual([]);
		expect(await db.select().from(leases).where(eq(leases.accountId, 'b'))).toEqual(before);
		expect(
			(await db.select().from(expenses).where(eq(expenses.accountId, 'a'))).length
		).toBeGreaterThan(0);
		expect(await db.select().from(documents)).toEqual([]);
		expect(await db.select().from(tasks).where(eq(tasks.accountId, 'a'))).not.toEqual([]);
	});
});
