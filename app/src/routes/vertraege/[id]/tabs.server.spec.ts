import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { createBankAccount } from '#lib/server/bank/accounts.ts';
import { assignTransaction } from '#lib/server/bank/transactions.ts';
import { listCo2Splits } from '#lib/server/co2.ts';
import { bankTransactions } from '#lib/server/db/schema.ts';
import { listDepositMovements } from '#lib/server/deposits.ts';
import { getLease } from '#lib/server/leases.ts';
import { listLedger } from '#lib/server/ledger.ts';
import {
	contextA,
	outcome,
	routeEvent,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions as co2Actions, load as loadCo2 } from './co2/+page.server';
import { actions as depositActions, load as loadDeposit } from './kaution/+page.server';
import { actions as ledgerActions, load as loadLedger } from './mietkonto/+page.server';
import { GET as reminderPdf } from './mietkonto/schreiben/[reminderId]/+server';
import {
	GET as reminderText,
	PUT as saveReminderText
} from './mietkonto/schreiben/[reminderId]/text/+server';

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
				debit: 240000,
				credit: 0,
				balance: 240000,
				paymentDefault: 240000
			}
		});
		// Only January; the balance still counts February and March.
		expect(await tab(loadLedger, '?from=2026-01&to=2026-01')).toMatchObject({
			data: { rows: [{}], debit: 80000, windowBalance: 80000, balance: 240000 }
		});
	});

	it('books, edits and deletes a payment', async () => {
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
		expect(await act(ledgerActions.delete, { id: rent.id })).toMatchObject({ fail: 400 });
		expect(await act(ledgerActions.update, { id: rent.id, date: '2026-03-01' })).toMatchObject({
			fail: 400
		});
		expect(await tab(loadLedger, `?bearbeiten=${rent.id}`)).toMatchObject({
			data: { editing: null }
		});
		// The payment opens in the edit dialog and is changed there.
		expect(await tab(loadLedger, `?bearbeiten=${payment.id}`)).toMatchObject({
			data: { editing: { id: payment.id, kind: 'payment', date: '2026-03-02', amount: 80000 } }
		});
		expect(
			await act(ledgerActions.update, { id: payment.id, date: '2026-03-03', amount: 'x' })
		).toMatchObject({ fail: 400, data: { form: 'edit' } });
		expect(
			await act(ledgerActions.update, {
				id: payment.id,
				date: '2026-03-03',
				amount: '750,00',
				note: 'bar'
			})
		).toEqual({ redirect: `/vertraege/${leaseId}/mietkonto` });
		expect((await listLedger(db, 'a', leaseId)).paid).toBe(75000);
		expect(await act(ledgerActions.delete, { id: payment.id })).toEqual({
			redirect: `/vertraege/${leaseId}/mietkonto`
		});
		expect((await listLedger(db, 'a', leaseId)).paid).toBe(0);

		// A refund is booked with its side and a positive amount; it stands in Soll.
		expect(
			await act(ledgerActions.payment, { date: '2026-03-04', side: 'refund', amount: '50,00' })
		).toEqual({ data: { booked: 'payment' } });
		const refund = (
			(await tab(loadLedger)) as {
				data: { rows: { kind: string; amount: number; debit: number; credit: number }[] };
			}
		).data.rows.find((row) => row.kind === 'payment');
		expect(refund).toMatchObject({ amount: -5000, debit: 5000, credit: 0 });
	});

	it('links a payment from the bank to its transaction and keeps it', async () => {
		const bank = await createBankAccount(db, contextA, {
			name: 'Mietkonto',
			iban: 'DE02120300000000202051',
			bic: null,
			holder: 'Oliver'
		});
		if (!bank.ok) throw new Error('setup failed');
		await db.insert(bankTransactions).values({
			id: 't-miete',
			accountId: 'a',
			bankAccountId: bank.id,
			bookingDate: '2026-03-02',
			amount: 80000,
			counterpartName: 'Max Müller',
			purpose: 'Miete März',
			fingerprint: 't-miete'
		});
		await assignTransaction(db, contextA, 't-miete', {
			target: 'rent',
			parts: [{ leaseId, amount: 80000 }]
		});
		const rows = (
			(await tab(loadLedger)) as {
				data: {
					rows: { id: string; kind: string; deletable: boolean; bankTransactionId: string }[];
				};
			}
		).data.rows;
		const payment = rows.find((row) => row.kind === 'payment')!;
		expect(payment).toMatchObject({
			deletable: false,
			fromBank: true,
			bankTransactionId: 't-miete'
		});
		expect(await act(ledgerActions.delete, { id: payment.id })).toEqual({
			fail: 400,
			data: { message: expect.stringContaining('stammt aus einem Umsatz') }
		});
		expect(await tab(loadLedger, `?bearbeiten=${payment.id}`)).toMatchObject({
			data: { editing: null }
		});
	});

	it('posts, edits and deletes a correction', async () => {
		expect(
			await act(ledgerActions.adjustment, {
				date: '2026-02-01',
				side: 'credit',
				amount: '50,00',
				note: 'Minderung'
			})
		).toEqual({ data: { booked: 'adjustment' } });
		// Without a side, or with a sign, the correction is refused: the side says the direction.
		expect(
			await act(ledgerActions.adjustment, { date: '2026-02-01', amount: '-50,00', note: 'x' })
		).toMatchObject({ fail: 400, data: { errors: { side: expect.any(String) } } });
		expect(await act(ledgerActions.adjustment, { date: 'x' })).toMatchObject({
			fail: 400,
			data: { form: 'adjustment' }
		});
		const rows = (
			(await tab(loadLedger)) as {
				data: {
					rows: { id: string; deletable: boolean; amount: number; debit: number; credit: number }[];
				};
			}
		).data.rows;
		const correction = rows.find((row) => row.amount === -5000)!;
		expect(correction.deletable).toBe(true);
		// A credit stands in Haben, without a sign.
		expect(correction).toMatchObject({ debit: 0, credit: 5000 });
		expect(
			await act(ledgerActions.update, {
				id: correction.id,
				date: '2026-03-01',
				side: 'credit',
				amount: '60,00',
				note: ''
			})
		).toMatchObject({ fail: 400, data: { form: 'edit', errors: { note: expect.any(String) } } });
		expect(
			await act(ledgerActions.update, {
				id: correction.id,
				date: '2026-03-01',
				side: 'credit',
				amount: '60,00',
				note: 'Minderung März'
			})
		).toEqual({ redirect: `/vertraege/${leaseId}/mietkonto` });
		expect(await tab(loadLedger, `?bearbeiten=${correction.id}`)).toMatchObject({
			data: { editing: { kind: 'adjustment', date: '2026-03-01', amount: -6000 } }
		});
		expect(await act(ledgerActions.delete, { id: correction.id })).toEqual({
			redirect: `/vertraege/${leaseId}/mietkonto`
		});
	});

	it('refuses to book on a lease of another account', async () => {
		const id = foreignLeaseId;
		expect(
			await act(ledgerActions.payment, { date: '2026-03-02', amount: '800,00' }, id)
		).toMatchObject({ error: 404 });
		expect(
			await act(
				ledgerActions.adjustment,
				{ date: '2026-03-02', side: 'claim', amount: '10,00', note: 'x' },
				id
			)
		).toMatchObject({ error: 404 });
		const [foreignLine] = (await listLedger(db, 'b', id)).lines;
		for (const handler of [ledgerActions.update, ledgerActions.delete]) {
			expect(
				await act(handler, { id: foreignLine.id, date: '2026-03-02', amount: '1,00' }, leaseId)
			).toMatchObject({ fail: 400 });
		}
	});
});

describe('mietkonto reminders', () => {
	it('writes a reminder for the overdue rent and deletes it once', async () => {
		const form = { level: '1', date: '2026-03-02', paymentDeadline: '2026-03-16' };
		const created = (await act(ledgerActions.reminder, form)) as {
			data: { reminderId: string };
		};
		expect(created.data.reminderId).toEqual(expect.any(String));
		const pdf = (id: string, reminderId: string) =>
			outcome(() => reminderPdf(routeEvent(db, { params: { id, reminderId } })));
		const printed = (await pdf(leaseId, created.data.reminderId)) as { data: Response };
		expect(printed.data.headers.get('Content-Type')).toBe('application/pdf');
		expect(new TextDecoder().decode((await printed.data.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
		// The letter is only found under its own lease.
		expect(await pdf(foreignLeaseId, created.data.reminderId)).toMatchObject({ error: 404 });

		// Its text, as laid out on the sheet, and edited there.
		const params = { id: leaseId, reminderId: created.data.reminderId };
		const shown = (await outcome(() => reminderText(routeEvent(db, { params })))) as {
			data: Response;
		};
		const { blocks } = (await shown.data.json()) as { blocks: { paragraph?: string }[] };
		const paragraphs = blocks.flatMap((block) => block.paragraph ?? []);
		const save = (json: unknown, id = leaseId) =>
			outcome(() => saveReminderText(routeEvent(db, { params: { ...params, id }, json })));
		expect(await save({ paragraphs: [...paragraphs, 'In zwei Raten.'] })).toMatchObject({
			data: { status: 204 }
		});
		expect(await save({ paragraphs: ['', ...paragraphs.slice(1)] })).toMatchObject({
			error: 400
		});
		expect(await save({ paragraphs }, foreignLeaseId)).toMatchObject({ error: 404 });
		expect(
			await outcome(() =>
				reminderText(routeEvent(db, { params: { ...params, id: foreignLeaseId } }))
			)
		).toMatchObject({ error: 404 });
		const foreignSite = routeEvent(db, { params, json: { paragraphs } }) as {
			request: Request;
		};
		foreignSite.request.headers.set('origin', 'https://example.org');
		expect(await outcome(() => saveReminderText(foreignSite as never))).toMatchObject({
			error: 403
		});
		expect(await tab(loadLedger, `?schreiben=${created.data.reminderId}`)).toMatchObject({
			data: { reminder: { id: created.data.reminderId, level: 1 } }
		});
		expect(await act(ledgerActions.deleteReminder, { id: created.data.reminderId })).toEqual({
			redirect: `/vertraege/${leaseId}/mietkonto`
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

	it('edits a movement and deletes it once', async () => {
		await act(depositActions.add, { date: '2026-01-02', kind: 'received', amount: '100,00' });
		const [movement] = await listDepositMovements(db, 'a', leaseId);
		expect(await tab(loadDeposit, `?bearbeiten=${movement.id}`)).toMatchObject({
			data: { editing: { id: movement.id, amount: 10000 } }
		});
		const edit = { movementId: movement.id, date: '2026-01-03', kind: 'returned', amount: '40,00' };
		expect(await act(depositActions.update, { ...edit, amount: '0' })).toMatchObject({
			fail: 400,
			data: { edit: true }
		});
		expect(await act(depositActions.update, edit, foreignLeaseId)).toMatchObject({ fail: 404 });
		expect(await act(depositActions.update, edit)).toEqual({
			redirect: `/vertraege/${leaseId}/kaution`
		});
		expect(await listDepositMovements(db, 'a', leaseId)).toMatchObject([
			{ date: '2026-01-03', kind: 'returned', amount: -4000 }
		]);
		expect(await act(depositActions.delete, {})).toMatchObject({ fail: 400 });
		expect(
			await act(depositActions.delete, { movementId: movement.id }, foreignLeaseId)
		).toMatchObject({
			fail: 404
		});
		expect(await act(depositActions.delete, { movementId: movement.id })).toEqual({
			redirect: `/vertraege/${leaseId}/kaution`
		});
		expect(await act(depositActions.delete, { movementId: movement.id })).toMatchObject({
			fail: 404
		});
	});

	it('keeps a movement booked from a bank transaction', async () => {
		const bank = await createBankAccount(db, contextA, {
			name: 'Kautionskonto',
			iban: 'DE02120300000000202051',
			bic: null,
			holder: 'Oliver'
		});
		if (!bank.ok) throw new Error('setup failed');
		await db.insert(bankTransactions).values({
			id: 't1',
			accountId: 'a',
			bankAccountId: bank.id,
			bookingDate: '2026-01-02',
			amount: 180000,
			counterpartName: 'Max Müller',
			purpose: 'Kaution',
			fingerprint: 't1'
		});
		await assignTransaction(db, contextA, 't1', {
			target: 'deposit',
			parts: [{ leaseId, amount: 180000 }]
		});
		const [movement] = await listDepositMovements(db, 'a', leaseId);
		expect(await tab(loadDeposit, `?bearbeiten=${movement.id}`)).toMatchObject({
			data: { editing: null }
		});
		expect(
			await act(depositActions.update, {
				movementId: movement.id,
				date: '2026-01-02',
				kind: 'received',
				amount: '1700,00'
			})
		).toMatchObject({ fail: 400, data: { message: expect.stringContaining('Umsatz') } });
		expect(await act(depositActions.update, {})).toMatchObject({ fail: 400 });
		expect(await act(depositActions.delete, { movementId: movement.id })).toEqual({
			fail: 400,
			data: {
				message:
					'Diese Bewegung stammt aus einem Umsatz. Hebe die Zuordnung unter Bank auf, dann verschwindet sie hier.'
			}
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
		expect(await tab(loadCo2, `?bearbeiten=${row.id}`)).toMatchObject({
			data: { editing: { id: row.id } }
		});
		expect(await act(co2Actions.delete, { splitId: row.id })).toEqual({
			redirect: `/vertraege/${leaseId}/co2`
		});
	});

	it('refuses a lease of another account', async () => {
		expect(await act(co2Actions.create, split, foreignLeaseId)).toMatchObject({ error: 404 });
	});
});
