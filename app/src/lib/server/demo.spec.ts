import { isHttpError } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { countUnmatched } from './bank/transactions';
import type { Database } from './db';
import {
	associationStatements,
	auditLog,
	co2CostSplits,
	costItems,
	depositTransactions,
	documents,
	leases,
	operatingCostStatements,
	paymentReminders,
	payments,
	properties,
	tasks,
	taxYears,
	tenants,
	units
} from './db/schema';
import { createDemoData, isEmptyAccount } from './demo';
import { addDays, today } from '../dates';
import { addressKey } from './geocoding';
import { listBalances } from './ledger';
import { QUOTAS } from './quotas';
import { contextA, contextB, memoryStorage, seedUnit, testDatabase } from './testing';

let db: Database;
let storage: ReturnType<typeof memoryStorage>;

beforeEach(async () => {
	db = await testDatabase();
	storage = memoryStorage();
});

describe('createDemoData', () => {
	it('fills an empty account with properties, leases, history, letters and tasks', async () => {
		expect(await isEmptyAccount(db, 'a')).toBe(true);
		const result = await createDemoData(db, contextA, { storage });
		expect(result).toEqual({ ok: true, leases: 11 });

		const rows = async (
			table: typeof properties | typeof units | typeof tenants | typeof leases | typeof tasks
		) => db.select().from(table).where(eq(table.accountId, 'a'));
		const propertyRows = await db.select().from(properties).where(eq(properties.accountId, 'a'));
		expect(propertyRows.map((row) => [row.kind, row.state])).toEqual([
			['building', 'BE'],
			['condominium', 'BB'],
			['condominium', 'BY']
		]);
		// Placed on the map without asking the geocoder.
		for (const row of propertyRows) {
			expect(row.latitude).toBeTypeOf('number');
			expect(row.geocodedAddress).toBe(addressKey(row));
		}
		expect(await rows(units)).toHaveLength(6);
		// Every flat changed tenants in the history; the former tenants are archived with the
		// address they moved to, their deposits paid back. Nowak has given notice, and Krüger's
		// lease for the same flat starts the day after his ends.
		const tenantRows = await db.select().from(tenants).where(eq(tenants.accountId, 'a'));
		expect(tenantRows).toHaveLength(13);
		const former = tenantRows.filter((row) => row.archivedAt);
		expect(former).toHaveLength(6);
		expect(former.every((row) => row.city)).toBe(true);
		const deposits = await db
			.select()
			.from(depositTransactions)
			.where(eq(depositTransactions.accountId, 'a'));
		expect(deposits.filter((row) => row.kind === 'returned')).toHaveLength(5);
		const leaseRows = await db.select().from(leases).where(eq(leases.accountId, 'a'));
		const terminated = leaseRows.filter((row) => row.endDate && row.endDate > today());
		expect(terminated).toHaveLength(1);
		const [nowak] = terminated;
		expect(nowak.terminatedBy).toBe('tenant');
		expect(leaseRows.filter((row) => row.startDate > today())).toEqual([
			expect.objectContaining({ unitId: nowak.unitId, startDate: addDays(nowak.endDate!, 1) })
		]);
		expect(await rows(leases)).toHaveLength(11);
		expect(await rows(tasks)).toHaveLength(5);
		expect(await countUnmatched(db, 'a')).toBe(3);

		// Every history year but the last is settled: three properties over seven years, each
		// statement approved; the WEG figures and the Zinsbescheinigungen cover all eight years.
		const statements = await db
			.select()
			.from(operatingCostStatements)
			.where(eq(operatingCostStatements.accountId, 'a'));
		expect(statements).toHaveLength(21);
		expect(statements.every((row) => row.status === 'approved')).toBe(true);
		expect(
			await db.select().from(associationStatements).where(eq(associationStatements.accountId, 'a'))
		).toHaveLength(16);
		expect(await db.select().from(taxYears).where(eq(taxYears.accountId, 'a'))).toHaveLength(24);
		expect(
			(await db.select().from(costItems).where(eq(costItems.accountId, 'a'))).length
		).toBeGreaterThan(100);
		const reminders = await db
			.select()
			.from(paymentReminders)
			.where(eq(paymentReminders.accountId, 'a'));
		expect(reminders.map((row) => row.level).sort()).toEqual([1, 2]);
		// The Mahnung carries a line the landlord added on its sheet.
		expect(reminders.find((row) => row.level === 2)?.letterText).toContain('in zwei Raten');
		expect(
			await db.select().from(co2CostSplits).where(eq(co2CostSplits.accountId, 'a'))
		).toHaveLength(1);
		// Berger's Mietvertrag and Übergabeprotokoll, and a Grundsteuerbescheid per past year.
		const files = await db.select().from(documents).where(eq(documents.accountId, 'a'));
		expect(files).toHaveLength(2 + 8);
		expect(files.every((row) => row.mimeType === 'application/pdf')).toBe(true);
		expect(files.filter((row) => row.costItemId)).toHaveLength(8);
		expect(storage.files.size).toBe(10);

		// Only Berger is in arrears, by the two unpaid months before the current one plus the
		// current month; Schmidt and Yılmaz owe this month (open on the bank account), the CO₂
		// share is a credit to Weber and Albrecht, everyone else is settled.
		const balances = await listBalances(db, 'a');
		const berger = balances.reduce((max, balance) =>
			balance.balance > max.balance ? balance : max
		);
		expect(berger.balance).toBe(3 * (92000 + 16500 + 12500));
		expect(balances.filter((balance) => balance.balance > 0)).toHaveLength(3);
		expect(balances.filter((balance) => balance.balance < 0)).toHaveLength(1);

		expect(await isEmptyAccount(db, 'b')).toBe(true);
	});

	it('writes in one batch: a failure part-way leaves the account empty, so the demo can be retried', async () => {
		// The database refuses the task rows, which come late in the batch.
		await db.run(
			sql`create trigger refuse_tasks before insert on tasks begin select raise(abort, 'D1 down'); end`
		);
		await expect(createDemoData(db, contextA, { storage })).rejects.toThrow('D1 down');
		expect(await isEmptyAccount(db, 'a')).toBe(true);
		for (const table of [properties, units, tenants, leases, payments, costItems]) {
			expect(await db.select().from(table).where(eq(table.accountId, 'a'))).toEqual([]);
		}

		await db.run(sql`drop trigger refuse_tasks`);
		expect(await createDemoData(db, contextA, { storage })).toEqual({ ok: true, leases: 11 });
		expect(await db.select().from(tasks).where(eq(tasks.accountId, 'a'))).toHaveLength(5);
	});

	it('takes its rows out again when a later step fails, keeping what the account held', async () => {
		const [own] = await db
			.insert(tenants)
			.values({ accountId: 'a', firstName: 'Eva', lastName: 'Vorher' })
			.returning();
		// The letters to the tenant in arrears come after the batch.
		await db.run(
			sql`create trigger refuse_reminders before insert on payment_reminders begin select raise(abort, 'D1 down'); end`
		);
		await expect(createDemoData(db, contextA, { storage })).rejects.toThrow('D1 down');
		expect(await isEmptyAccount(db, 'a')).toBe(true);
		expect(await db.select().from(tenants).where(eq(tenants.accountId, 'a'))).toEqual([own]);
		for (const table of [leases, payments, costItems, operatingCostStatements, tasks]) {
			expect(await db.select().from(table).where(eq(table.accountId, 'a'))).toEqual([]);
		}

		await db.run(sql`drop trigger refuse_reminders`);

		// The documents come last; their files go with their rows.
		await db.run(
			sql`create trigger refuse_documents before insert on documents when (select count(*) from documents) >= 3 begin select raise(abort, 'D1 down'); end`
		);
		await expect(createDemoData(db, contextA, { storage })).rejects.toThrow('D1 down');
		expect(await isEmptyAccount(db, 'a')).toBe(true);
		expect(await db.select().from(documents).where(eq(documents.accountId, 'a'))).toEqual([]);
		expect(storage.files.size).toBe(0);
		await db.run(sql`drop trigger refuse_documents`);
		expect(await createDemoData(db, contextA, { storage })).toEqual({ ok: true, leases: 11 });
	});

	it('creates the demo once when the button is pressed twice at the same time', async () => {
		const results = await Promise.all([
			createDemoData(db, contextA, { storage }),
			createDemoData(db, contextA, { storage })
		]);
		expect(results).toContainEqual({ ok: true, leases: 11 });
		expect(results).toContainEqual({ ok: false, reason: 'not-empty' });
		expect(await db.select().from(properties).where(eq(properties.accountId, 'a'))).toHaveLength(3);
		expect(await db.select().from(leases).where(eq(leases.accountId, 'a'))).toHaveLength(11);
		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit.filter((entry) => entry.summary === 'Demodaten angelegt')).toHaveLength(1);
	});

	it('refuses with 409 when the account has no room for the tasks', async () => {
		const limit = QUOTAS.tasks.max;
		QUOTAS.tasks.max = 1;
		try {
			const refusal = await createDemoData(db, contextA, { storage }).catch((e) => e);
			expect(isHttpError(refusal, 409)).toBe(true);
		} finally {
			QUOTAS.tasks.max = limit;
		}
		expect(await isEmptyAccount(db, 'a')).toBe(true);
	});

	it('refuses an account that already has a property', async () => {
		await seedUnit(db, 'a');
		expect(await createDemoData(db, contextA, { storage })).toEqual({
			ok: false,
			reason: 'not-empty'
		});
		expect(await createDemoData(db, contextB, { storage })).toMatchObject({ ok: true });
	});
});
