import { isHttpError } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { countUnmatched } from './bank/transactions';
import type { Database } from './db';
import {
	associationStatements,
	auditLog,
	co2CostSplits,
	serviceProviders,
	statementResults,
	costItems,
	depositSettlements,
	depositTransactions,
	documents,
	expenses,
	handoverProtocols,
	leaseUnits,
	leases,
	operatingCostStatements,
	paymentReminders,
	payments,
	properties,
	rentChanges,
	tasks,
	taxYears,
	tenants,
	units
} from './db/schema';
import type { LeaseStatement } from '../domain/statement';
import { createDemoData, isEmptyAccount } from './demo';
import { statementHintScope, withDismissals } from './hints';
import { getStatement } from './statements';
import { addDays, today } from '../dates';
import { listDeadlines } from './deadlines';
import { addressKey } from './geocoding';
import { listLeases, termsOverlap } from './leases';
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
		expect(result).toEqual({ ok: true, leases: 11, statementId: expect.any(String) });

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
		// lease for the same flat starts the day after his ends. Clara Brandt is new and still waits
		// for her lease, with letters to her current flat.
		const tenantRows = await db.select().from(tenants).where(eq(tenants.accountId, 'a'));
		expect(tenantRows).toHaveLength(15);
		const former = tenantRows.filter((row) => row.archivedAt);
		expect(former).toHaveLength(7);
		const leaseTenantIds = new Set(
			(await listLeases(db, 'a')).flatMap((lease) => lease.parties.map((party) => party.tenant.id))
		);
		expect(
			tenantRows.filter((row) => !leaseTenantIds.has(row.id)).map((row) => row.lastName)
		).toEqual(['Brandt']);
		// On the Weber lease Jonas Albrecht took Sophie Weber's place by a Nachtrag.
		const weber = (await listLeases(db, 'a')).find((lease) => lease.unit.name === 'Wohnung 9')!;
		expect(
			weber.parties.map((party) => [party.tenant.firstName, !!party.joinedOn, !!party.leftOn])
		).toEqual([
			['Jonas', true, false],
			['Julia', false, false],
			['Sophie', false, true]
		]);
		expect(weber.tenants.map((tenant) => tenant.firstName)).toEqual(['Jonas', 'Julia']);
		expect(former.every((row) => row.city)).toBe(true);
		const deposits = await db
			.select()
			.from(depositTransactions)
			.where(eq(depositTransactions.accountId, 'a'));
		expect(deposits.filter((row) => row.kind === 'returned')).toHaveLength(5);
		// Each former tenant's deposit settled with a letter; its bookings bring the deposit to zero.
		const settlements = await db
			.select()
			.from(depositSettlements)
			.where(eq(depositSettlements.accountId, 'a'));
		expect(settlements).toHaveLength(5);
		// An Übergabeprotokoll for each move-out, the withheld damage marked in its room.
		const handovers = await db
			.select()
			.from(handoverProtocols)
			.where(eq(handoverProtocols.accountId, 'a'));
		const moveOuts = handovers.filter((row) => row.kind === 'move_out');
		expect(moveOuts).toHaveLength(5);
		expect(
			moveOuts.flatMap((row) => row.rooms).filter((room) => room.condition === 'damaged')
		).toHaveLength(3);
		expect(handovers.filter((row) => row.kind === 'move_in').length).toBeGreaterThan(3);
		expect(settlements.every((row) => row.letterText.includes('Mietsicherheit'))).toBe(true);
		for (const settlement of settlements) {
			const held = deposits
				.filter((row) => row.leaseId === settlement.leaseId)
				.reduce((sum, row) => sum + row.amount, 0);
			expect(held).toBe(0);
		}
		const leaseRows = await db.select().from(leases).where(eq(leases.accountId, 'a'));
		const terminated = leaseRows.filter((row) => row.endDate && row.endDate > today());
		expect(terminated).toHaveLength(1);
		const [nowak] = terminated;
		expect(nowak.terminatedBy).toBe('tenant');
		expect(leaseRows.filter((row) => row.startDate > today())).toEqual([
			expect.objectContaining({ unitId: nowak.unitId, startDate: addDays(nowak.endDate!, 1) })
		]);
		expect(await rows(leases)).toHaveLength(11);
		// One lease per unit at a time, extra units included, as createLease demands.
		const extra = await db.select().from(leaseUnits).where(eq(leaseUnits.accountId, 'a'));
		const holders = leaseRows.flatMap((lease) => [
			{ unitId: lease.unitId, lease },
			...extra
				.filter((row) => row.leaseId === lease.id)
				.map((row) => ({ unitId: row.unitId, lease }))
		]);
		const overlapping = holders.filter((a) =>
			holders.some(
				(b) => a.unitId === b.unitId && a.lease.id !== b.lease.id && termsOverlap(a.lease, b.lease)
			)
		);
		expect(overlapping).toEqual([]);
		expect(await rows(tasks)).toHaveLength(16);
		// Nine Dienstleister, among them the Hausmeisterdienst and the Schornsteinfeger; six
		// Reparaturen done and paid for, two still open.
		const providers = await db
			.select()
			.from(serviceProviders)
			.where(eq(serviceProviders.accountId, 'a'));
		expect(providers.map((row) => row.service)).toEqual(
			expect.arrayContaining(['Hausmeisterdienst', 'Schornsteinfeger'])
		);
		expect(providers).toHaveLength(9);
		const repairs = (await db.select().from(tasks).where(eq(tasks.accountId, 'a'))).filter(
			(row) => row.category === 'repair'
		);
		expect(repairs.filter((row) => row.done)).toHaveLength(6);
		expect(repairs.filter((row) => !row.done)).toHaveLength(2);
		const paid = (await db.select().from(expenses).where(eq(expenses.accountId, 'a'))).filter(
			(row) => row.taskId
		);
		expect(paid).toHaveLength(7);
		expect(paid.every((row) => repairs.some((task) => task.id === row.taskId))).toBe(true);
		expect(paid.every((row) => row.category === 'maintenance')).toBe(true);
		// A Reparatur's bills name its Dienstleister; the expenses of every history year name some,
		// and leave others unknown.
		expect(
			paid.every(
				(row) =>
					row.serviceProviderId ===
					repairs.find((task) => task.id === row.taskId)!.serviceProviderId
			)
		).toBe(true);
		const allExpenses = await db.select().from(expenses).where(eq(expenses.accountId, 'a'));
		const caretakerId = providers.find((row) => row.service === 'Hausmeisterdienst')!.id;
		expect(
			allExpenses.filter((row) => row.serviceProviderId === caretakerId).length
		).toBeGreaterThanOrEqual(7);
		expect(allExpenses.some((row) => row.serviceProviderId === null)).toBe(true);
		expect(await countUnmatched(db, 'a')).toBe(3);

		// Every history year but the last is settled: three properties over seven years, each
		// statement approved; the WEG figures and the Zinsbescheinigungen cover all eight years.
		const statements = await db
			.select()
			.from(operatingCostStatements)
			.where(eq(operatingCostStatements.accountId, 'a'));
		expect(statements).toHaveLength(21);
		expect(statements.every((row) => row.status === 'approved')).toBe(true);
		// The tenants of the Etagenheizung in Rosenheim buy their gas themselves: their statements
		// say so and pass on only the Wartung, as an operating cost.
		const ownHeating = (
			await db.select().from(statementResults).where(eq(statementResults.accountId, 'a'))
		)
			.map((row) => JSON.parse(row.result) as LeaseStatement)
			.filter((result) => result.ownHeatingContract);
		expect(ownHeating.length).toBeGreaterThanOrEqual(6);
		for (const result of ownHeating) {
			expect(result.excluded).toEqual([]);
			expect(result.lines.some((line) => line.heating)).toBe(false);
			expect(result.lines.map((line) => line.description)).toContainEqual(
				expect.stringMatching(/^Wartung Gastherme \d{4}$/)
			);
			expect(result.warnings.filter((warning) => warning.code === 'own_heating_share')).toEqual([]);
		}
		// One Hinweis of an early statement was closed back then; last year's still show theirs.
		const hintsOf = async (id: string) => {
			const view = (await getStatement(db, 'a', id))!;
			return withDismissals(
				db,
				contextA.userId,
				statementHintScope(view.property.id, view.statement.periodStart),
				view.result.property.warnings
			);
		};
		const byYear = [...statements].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
		const closed = [];
		for (const statement of byYear) {
			for (const hint of await hintsOf(statement.id)) if (hint.dismissed) closed.push(statement);
		}
		expect(closed).toHaveLength(1);
		expect(closed[0].periodStart < byYear.at(-1)!.periodStart).toBe(true);
		expect(
			(await hintsOf(result.ok ? result.statementId : '')).some((hint) => !hint.dismissed)
		).toBe(true);
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
		// Eight § 558 increases with their letters and consent, and Schmidt's demand still open.
		const comparative = (
			await db.select().from(rentChanges).where(eq(rentChanges.accountId, 'a'))
		).filter((row) => row.reason === 'comparative');
		expect(comparative).toHaveLength(9);
		expect(comparative.every((row) => row.letterText?.includes('§ 558 BGB'))).toBe(true);
		const pending = comparative.filter((row) => row.status === 'proposed');
		expect(pending).toEqual([
			expect.objectContaining({ baseRent: 82500, consentedOn: null, cappingPercent: 15 })
		]);
		expect(comparative.filter((row) => row.consentedOn)).toHaveLength(8);
		const deadlines = await listDeadlines(db, 'a');
		expect(deadlines.map((deadline) => deadline.kind)).toContain('comparative_consent');
		// The leases from before the booked history keep their books from its first month; nothing
		// of theirs that fell due earlier shows up as a deadline.
		expect(leaseRows.filter((row) => row.ledgerStart !== null)).toHaveLength(5);
		for (const deadline of deadlines.filter((row) => row.leaseId)) {
			const lease = leaseRows.find((row) => row.id === deadline.leaseId)!;
			expect(deadline.date >= (lease.ledgerStart ?? lease.startDate)).toBe(true);
		}
		expect(
			await db.select().from(co2CostSplits).where(eq(co2CostSplits.accountId, 'a'))
		).toHaveLength(1);
		// Berger's Mietvertrag and Übergabeprotokoll, and a Grundsteuerbescheid and a gas bill per
		// past year.
		const files = await db.select().from(documents).where(eq(documents.accountId, 'a'));
		expect(files).toHaveLength(2 + 8 + 8);
		expect(files.every((row) => row.mimeType === 'application/pdf')).toBe(true);
		expect(files.filter((row) => row.costItemId)).toHaveLength(16);
		expect(storage.files.size).toBe(18);

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
		expect(await createDemoData(db, contextA, { storage })).toEqual({
			ok: true,
			leases: 11,
			statementId: expect.any(String)
		});
		expect(await db.select().from(tasks).where(eq(tasks.accountId, 'a'))).toHaveLength(16);
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
		expect(await createDemoData(db, contextA, { storage })).toEqual({
			ok: true,
			leases: 11,
			statementId: expect.any(String)
		});
	});

	it('creates the demo once when the button is pressed twice at the same time', async () => {
		const results = await Promise.all([
			createDemoData(db, contextA, { storage }),
			createDemoData(db, contextA, { storage })
		]);
		expect(results).toContainEqual({ ok: true, leases: 11, statementId: expect.any(String) });
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
