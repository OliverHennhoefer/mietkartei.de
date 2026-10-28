import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { accounts, auditLog, payments } from './db/schema';
import {
	createSettlement,
	deleteSettlement,
	getSettlement,
	settlementLetter,
	updateSettlementText
} from './deposit-settlements';
import { addDepositMovement, deleteDepositMovement, listDepositMovements } from './deposits';
import { createPayment, deletePayment, getEditableLine, lastPayment, listLedger } from './ledger';
import { contextA, contextB, seedLease, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;

const input = {
	date: '2026-02-15',
	interest: 1200,
	deductions: [{ label: 'Reparatur der Badtür', amount: 30000 }],
	offsetArrears: true
};

beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	const tenantId = await seedTenant(db, 'a');
	// 800 € a month through 2025, deposit 1.800 €; eleven months paid, one owed.
	leaseId = await seedLease(db, 'a', unitId, {
		startDate: '2025-01-01',
		endDate: '2025-12-31',
		tenantIds: [tenantId]
	});
	await addDepositMovement(db, contextA, {
		leaseId,
		date: '2025-01-02',
		kind: 'received',
		amount: 180000
	});
	await createPayment(db, contextA, {
		leaseId,
		date: '2025-12-01',
		amount: 880000,
		source: 'manual',
		note: 'Mieten'
	});
	await db.update(accounts).set({ iban: 'DE02120300000000202051' }).where(eq(accounts.id, 'a'));
});

describe('createSettlement', () => {
	it('books interest, Einbehalte, the offset and the payout with its letter', async () => {
		expect(await listLedger(db, 'a', leaseId)).toMatchObject({ balance: 80000 });
		const created = await createSettlement(db, contextA, leaseId, input);
		expect(created).toMatchObject({ ok: true });

		expect(await getSettlement(db, 'a', leaseId)).toMatchObject({
			date: '2026-02-15',
			payout: 71200,
			remaining: 0
		});
		const movements = await listDepositMovements(db, 'a', leaseId);
		expect(movements.map((row) => [row.kind, row.amount, row.note])).toEqual([
			['received', 180000, null],
			['interest', 1200, 'Zinsen bis zur Kautionsabrechnung'],
			['withheld', -30000, 'Einbehalt: Reparatur der Badtür'],
			['withheld', -80000, 'Verrechnet mit dem Mietrückstand'],
			['returned', -71200, 'Auszahlung laut Kautionsabrechnung']
		]);
		expect(movements.reduce((sum, row) => sum + row.amount, 0)).toBe(0);
		// The arrears are paid from the deposit, which is no payment of the tenant's.
		expect(await listLedger(db, 'a', leaseId)).toMatchObject({ balance: 0 });
		expect(await lastPayment(db, 'a', leaseId)).toMatchObject({ amount: 880000 });

		const result = await settlementLetter(db, 'a', leaseId);
		expect(result?.letter.subject).toBe('Abrechnung der Mietsicherheit für EG links');
		expect(result?.filename).toMatch(/^Kautionsabrechnung .* 15\.02\.2026\.pdf$/);
		expect(result?.letter.blocks?.[2]).toMatchObject({
			table: { footer: ['Auszahlung an Sie', expect.stringContaining('712,00')] }
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'create'));
		expect(audit.map((entry) => entry.summary)).toContainEqual(
			expect.stringContaining('Kautionsabrechnung vom 15.02.2026 erstellt')
		);
	});

	it('refuses before the end, in the future, twice and above the deposit', async () => {
		const refusal = (overrides: Partial<typeof input>) =>
			createSettlement(db, contextA, leaseId, { ...input, ...overrides });
		expect(await refusal({ date: '2025-12-30' })).toMatchObject({
			ok: false,
			message: expect.stringContaining('ab dem Vertragsende am 31.12.2025')
		});
		expect(await refusal({ date: '2099-01-01' })).toMatchObject({
			message: 'Die Abrechnung kann nicht in der Zukunft liegen.'
		});
		expect(await refusal({ deductions: [{ label: 'Schaden', amount: 200000 }] })).toMatchObject({
			message: expect.stringContaining('übersteigen die Kaution')
		});
		expect(await refusal({})).toMatchObject({ ok: true });
		expect(await refusal({})).toMatchObject({ message: 'Die Kaution ist schon abgerechnet.' });
		expect(await createSettlement(db, contextB, leaseId, input)).toBeUndefined();

		const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 2' });
		const running = await seedLease(db, 'a', unitId);
		expect(await createSettlement(db, contextA, running, input)).toMatchObject({
			message: expect.stringContaining('wenn der Mietvertrag ein Ende hat')
		});
	});
});

describe('the bookings of a settlement', () => {
	it('stay as they are until the settlement is deleted with them', async () => {
		await createSettlement(db, contextA, leaseId, input);
		const movements = await listDepositMovements(db, 'a', leaseId);
		const booked = movements.find((row) => row.kind === 'returned')!;
		expect(await deleteDepositMovement(db, contextA, leaseId, booked.id)).toBe('from-settlement');
		const [offset] = await db.select().from(payments).where(eq(payments.source, 'deposit'));
		expect(await getEditableLine(db, 'a', leaseId, offset.id)).toBeUndefined();
		expect(await deletePayment(db, contextA, offset.id)).toBe('from-settlement');

		expect(await deleteSettlement(db, contextB, leaseId)).toBe(false);
		expect(await deleteSettlement(db, contextA, leaseId)).toBe(true);
		expect(await getSettlement(db, 'a', leaseId)).toBeUndefined();
		expect(await listDepositMovements(db, 'a', leaseId)).toHaveLength(1);
		expect(await listLedger(db, 'a', leaseId)).toMatchObject({ balance: 80000 });
		expect(await deleteSettlement(db, contextA, leaseId)).toBe(false);
	});
});

describe('updateSettlementText', () => {
	it('keeps the paragraphs before the table', async () => {
		expect(await updateSettlementText(db, contextA, leaseId, ['x'])).toBeUndefined();
		await createSettlement(db, contextA, leaseId, input);
		const text = (await getSettlement(db, 'a', leaseId))!.letterText.split('\n\n');
		expect(await updateSettlementText(db, contextA, leaseId, [text[0], ''])).toMatchObject({
			ok: false
		});
		expect(
			await updateSettlementText(db, contextA, leaseId, [...text, 'Mit Dank für die Mietzeit.'])
		).toMatchObject({ ok: true });
		expect((await getSettlement(db, 'a', leaseId))!.letterText).toContain('Dank für die Mietzeit');
		// Unchanged text writes nothing.
		const before = (await db.select().from(auditLog)).length;
		await updateSettlementText(db, contextA, leaseId, [...text, 'Mit Dank für die Mietzeit.']);
		expect(await db.select().from(auditLog)).toHaveLength(before);
	});
});
