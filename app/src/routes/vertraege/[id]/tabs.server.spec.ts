import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { listCo2Splits } from '#lib/server/co2.ts';
import { listDepositMovements } from '#lib/server/deposits.ts';
import { getLease } from '#lib/server/leases.ts';
import { listLedger } from '#lib/server/ledger.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions as co2Actions, load as loadCo2 } from './co2/+page.server';
import { actions as depositActions, load as loadDeposit } from './kaution/+page.server';
import { actions as ledgerActions, load as loadLedger } from './mietkonto/+page.server';

// The Mietkonto, Kaution and CO₂ tabs of a lease. The layout answers 404 for another account's
// lease; the actions run without it, so each must refuse a foreign lease on its own.

let db: Database;
let leaseId: string;
let foreignLeaseId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-02T10:00:00Z'));
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	leaseId = await seedLease(db, 'a', unitId, { startDate: '2026-01-01' });
	const other = await seedUnit(db, 'b');
	foreignLeaseId = await seedLease(db, 'b', other.unitId);
});

afterEach(() => {
	vi.useRealTimers();
});

async function tab(handler: (event: never) => unknown, query = '') {
	const parent = { lease: await getLease(db, 'a', leaseId) };
	return outcome(() =>
		handler(routeEvent(db, { params: { id: leaseId }, url: `/x${query}`, parent }))
	);
}

function act(handler: (event: never) => unknown, form: Record<string, string> = {}, id = leaseId) {
	return outcome(() => handler(routeEvent(db, { params: { id }, form })));
}

describe('mietkonto', () => {
	it('shows the months asked for with the balance over everything', async () => {
		expect(await tab(loadLedger)).toMatchObject({
			data: {
				range: { from: '2025-04', to: '2026-03' },
				rows: [{}, {}, {}],
				charged: 240000,
				balance: 240000,
				balanceText: expect.stringContaining('Rückstand'),
				paymentDefault: 240000
			}
		});
		// Only January; the balance still counts February and March.
		expect(await tab(loadLedger, '?from=2026-01&to=2026-01')).toMatchObject({
			data: { rows: [{}], charged: 80000, windowBalance: 80000, balance: 240000 }
		});
	});

	it('books and deletes a payment', async () => {
		expect(
			await act(ledgerActions.payment, { date: '2026-03-02', amount: '800,00', note: '' })
		).toEqual({ data: { booked: 'payment' } });
		expect(await act(ledgerActions.payment, { date: '', amount: 'x' })).toMatchObject({
			fail: 400,
			data: { form: 'payment' }
		});
		const rows = (
			(await tab(loadLedger)) as {
				data: { rows: { id: string; kind: string; deletable: boolean }[] };
			}
		).data.rows;
		const payment = rows.find((row) => row.kind === 'payment')!;
		expect(payment.deletable).toBe(true);
		// A rent charge cannot be deleted here, a payment id is not a charge.
		const rent = rows.find((row) => row.kind === 'charge')!;
		expect(rent.deletable).toBe(false);
		expect(await act(ledgerActions.deleteCharge, { id: rent.id })).toMatchObject({ fail: 400 });
		expect(await act(ledgerActions.deleteCharge, { id: payment.id })).toMatchObject({ fail: 400 });
		expect(await act(ledgerActions.deletePayment, { id: rent.id })).toMatchObject({ fail: 400 });
		expect(await act(ledgerActions.deletePayment, { id: payment.id })).toEqual({
			data: { deleted: 'payment' }
		});
		expect((await listLedger(db, 'a', leaseId)).paid).toBe(0);
	});

	it('posts and deletes a correction', async () => {
		expect(
			await act(ledgerActions.adjustment, {
				date: '2026-02-01',
				amount: '-50,00',
				note: 'Minderung'
			})
		).toEqual({ data: { booked: 'adjustment' } });
		expect(await act(ledgerActions.adjustment, { date: 'x' })).toMatchObject({
			fail: 400,
			data: { form: 'adjustment' }
		});
		const rows = (
			(await tab(loadLedger)) as {
				data: { rows: { id: string; deletable: boolean; amount: number }[] };
			}
		).data.rows;
		const correction = rows.find((row) => row.amount === -5000)!;
		expect(correction.deletable).toBe(true);
		expect(await act(ledgerActions.deleteCharge, { id: correction.id })).toEqual({
			data: { deleted: 'adjustment' }
		});
	});

	it('refuses to book on a lease of another account', async () => {
		const id = foreignLeaseId;
		expect(
			await act(ledgerActions.payment, { date: '2026-03-02', amount: '800,00' }, id)
		).toMatchObject({ error: 404 });
		expect(
			await act(ledgerActions.adjustment, { date: '2026-03-02', amount: '10,00', note: 'x' }, id)
		).toMatchObject({ error: 404 });
		const [foreignLine] = (await listLedger(db, 'b', id)).lines;
		expect(await act(ledgerActions.deleteCharge, { id: foreignLine.id }, leaseId)).toMatchObject({
			fail: 400
		});
	});
});

describe('mietkonto reminders', () => {
	it('writes a reminder for the overdue rent and deletes it once', async () => {
		const form = { level: '1', date: '2026-03-02', paymentDeadline: '2026-03-16' };
		const created = (await act(ledgerActions.reminder, form)) as {
			data: { reminderId: string };
		};
		expect(created.data.reminderId).toEqual(expect.any(String));
		expect(await act(ledgerActions.deleteReminder, { id: created.data.reminderId })).toEqual({
			data: { deleted: 'reminder' }
		});
		expect(await act(ledgerActions.deleteReminder, { id: created.data.reminderId })).toEqual({
			fail: 400,
			data: { message: 'Dieses Schreiben gibt es nicht mehr.' }
		});
	});

	it('refuses an invalid form, a future date and a lease of another account', async () => {
		expect(await act(ledgerActions.reminder, { level: '9', date: 'x' })).toMatchObject({
			fail: 400,
			data: { form: 'reminder' }
		});
		expect(
			await act(ledgerActions.reminder, {
				level: '1',
				date: '2026-03-10',
				paymentDeadline: '2026-03-20'
			})
		).toEqual({
			fail: 400,
			data: { message: 'Das Schreiben kann nicht in die Zukunft datiert werden.' }
		});
		expect(
			await act(
				ledgerActions.reminder,
				{ level: '1', date: '2026-03-02', paymentDeadline: '2026-03-16' },
				foreignLeaseId
			)
		).toMatchObject({ error: 404 });
	});
});

describe('kaution', () => {
	it('shows the instalments until the deposit is paid in', async () => {
		expect(await tab(loadDeposit)).toMatchObject({
			data: { movements: [], instalments: [{}, {}, {}], today: '2026-03-02' }
		});
		expect(
			await act(depositActions.add, { date: '2026-01-02', kind: 'received', amount: '1800,00' })
		).toEqual({ data: { added: true } });
		expect(await tab(loadDeposit)).toMatchObject({
			data: { movements: [{}], summary: { received: 180000 }, instalments: [] }
		});
	});

	it('refuses invalid movements and a lease of another account', async () => {
		expect(await act(depositActions.add, { kind: 'bonus', amount: '0' })).toMatchObject({
			fail: 400
		});
		expect(
			await act(
				depositActions.add,
				{ date: '2026-01-02', kind: 'received', amount: '10,00' },
				foreignLeaseId
			)
		).toMatchObject({ error: 404 });
	});

	it('deletes a movement once', async () => {
		await act(depositActions.add, { date: '2026-01-02', kind: 'received', amount: '100,00' });
		const [movement] = await listDepositMovements(db, 'a', leaseId);
		expect(await act(depositActions.delete, {})).toMatchObject({ fail: 400 });
		expect(
			await act(depositActions.delete, { movementId: movement.id }, foreignLeaseId)
		).toMatchObject({
			fail: 404
		});
		expect(await act(depositActions.delete, { movementId: movement.id })).toEqual({
			data: { deleted: true }
		});
		expect(await act(depositActions.delete, { movementId: movement.id })).toMatchObject({
			fail: 404
		});
	});
});

describe('co2', () => {
	const split = {
		year: '2025',
		fuel: 'gas',
		fuelKwh: '25000',
		co2Kg: '5025',
		co2Cost: '300,00',
		area: '72,5',
		invoiceDate: '2026-02-10',
		claimedOn: '2026-02-15'
	};

	it('suggests last year and lists the splits', async () => {
		expect(await tab(loadCo2)).toMatchObject({
			data: { splits: [], defaults: { year: 2025, claimedOn: '2026-03-02' } }
		});
	});

	it('records one split per year and deletes it', async () => {
		expect(await act(co2Actions.create, split)).toEqual({
			data: { created: { year: 2025, amount: expect.any(Number) } }
		});
		expect(await act(co2Actions.create, split)).toMatchObject({
			fail: 400,
			data: { errors: { year: expect.stringContaining('gibt es schon') } }
		});
		expect(await act(co2Actions.create, { ...split, co2Kg: '' })).toMatchObject({ fail: 400 });
		const [row] = await listCo2Splits(db, 'a', leaseId);
		expect(await act(co2Actions.delete, { splitId: '' })).toMatchObject({ error: 404 });
		expect(await act(co2Actions.delete, { splitId: row.id }, foreignLeaseId)).toMatchObject({
			error: 404
		});
		expect(await act(co2Actions.delete, { splitId: row.id })).toEqual({ data: { deleted: true } });
	});

	it('refuses a lease of another account', async () => {
		expect(await act(co2Actions.create, split, foreignLeaseId)).toMatchObject({ error: 404 });
	});
});
