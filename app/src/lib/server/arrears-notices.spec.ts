import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintRows } from '../domain/bank-matching';
import type { IsoDate } from '../dates';
import { arrearsEntries, paymentExpectedBy } from './arrears-notices';
import { createBankAccount } from './bank/accounts';
import type { Database } from './db';
import { bankConnections, bankTransactions } from './db/schema';
import { createPayment, postCharge } from './ledger';
import { findEntry } from './notifications';
import { contextA, seedLease, seedTenant, seedUnit, testDatabase } from './testing';

// A lease from January 2026 at 800 € a month, due on the third working day: 05.01., 04.02.,
// 04.03. (Wednesday) and, after Easter, 07.04.2026.

let db: Database;
let leaseId: string;

async function at(day: IsoDate) {
	vi.setSystemTime(new Date(`${day}T10:00:00Z`));
	return arrearsEntries(db, 'a', 'https://app.mietkartei.de', day);
}

async function pay(date: IsoDate, amount = 80000) {
	await createPayment(db, contextA, { leaseId, date, amount, source: 'manual' });
}

async function bankAccount(): Promise<string> {
	const created = await createBankAccount(db, contextA, {
		name: 'Mietkonto',
		iban: 'DE02120300000000202051',
		bic: null,
		holder: 'Oliver'
	});
	if (!created.ok) throw new Error('setup failed');
	return created.id;
}

async function booking(
	bankAccountId: string,
	bookingDate: IsoDate,
	status: 'unmatched' | 'matched'
) {
	const [row] = await fingerprintRows([
		{
			bookingDate,
			valueDate: bookingDate,
			amount: -5000,
			counterpartName: 'Stadtwerke',
			counterpartIban: null,
			purpose: `Abschlag ${bookingDate}`,
			externalId: null
		}
	]);
	await db.insert(bankTransactions).values({ accountId: 'a', bankAccountId, status, ...row });
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a', { name: 'EG links' });
	const tenantId = await seedTenant(db, 'a', { firstName: 'Max', lastName: 'Müller' });
	leaseId = await seedLease(db, 'a', unitId, { startDate: '2026-01-01', tenantIds: [tenantId] });
	await pay('2026-01-05');
	await pay('2026-02-04');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('paymentExpectedBy', () => {
	it('waits two working days after the due date', () => {
		expect(paymentExpectedBy('2026-03-04')).toBe('2026-03-06');
		// Friday: Monday and Tuesday.
		expect(paymentExpectedBy('2026-03-06')).toBe('2026-03-10');
		// Gründonnerstag: Karfreitag and Ostermontag do not count.
		expect(paymentExpectedBy('2026-04-02')).toBe('2026-04-08');
	});
});

describe('arrearsEntries', () => {
	it('tells about a missing rent two working days after it fell due', async () => {
		expect(await at('2026-03-05')).toEqual([]);
		expect(await at('2026-03-06')).toEqual([
			{
				uid: `arrears-${leaseId}@mietkartei.de`,
				key: `arrears-${leaseId}`,
				kind: 'arrears',
				date: '2026-03-04',
				title: 'Miete ausgeblieben',
				overdue: true,
				summary: 'Miete ausgeblieben',
				description: expect.stringMatching(/^Max Müller: 800,00\s€, fällig am 04\.03\.2026/),
				url: `https://app.mietkartei.de/vertraege/${leaseId}/mietkonto`
			}
		]);
		await pay('2026-03-06');
		expect(await at('2026-03-06')).toEqual([]);
	});

	it('moves on to the next month that is missed, with the whole Rückstand', async () => {
		const [april] = await at('2026-04-10');
		expect(april).toMatchObject({ date: '2026-04-07', title: 'Miete ausgeblieben' });
		expect(april.description).toContain('Insgesamt offen: 1.600,00');
	});

	it('tells about a part left open, again each month it stays open', async () => {
		await pay('2026-03-04', 70000);
		expect(await at('2026-03-20')).toEqual([
			expect.objectContaining({ title: 'Rückstand', date: '2026-03-04' })
		]);
		expect(await at('2026-03-31')).toEqual([
			expect.objectContaining({ title: 'Rückstand', date: '2026-03-04' })
		]);
		// 800 € in April settle March first, so 100 € of April are open: a new Hinweis.
		await pay('2026-04-07');
		expect(await at('2026-04-10')).toEqual([
			expect.objectContaining({
				title: 'Rückstand',
				date: '2026-04-07',
				description: expect.stringContaining('100,00')
			})
		]);
	});

	it('waits for bank data that reaches the day the money should be there', async () => {
		const id = await bankAccount();
		expect(await at('2026-03-10')).toEqual([]);
		await booking(id, '2026-03-05', 'matched');
		expect(await at('2026-03-10')).toEqual([]);
		await booking(id, '2026-03-09', 'unmatched');
		const [entry] = await at('2026-03-10');
		expect(entry).toMatchObject({ title: 'Miete ausgeblieben' });
		expect(entry.description).toContain(
			'Ein Bankumsatz ist noch nicht zugeordnet, vielleicht ist die Zahlung dabei.'
		);
	});

	it('calls a missed charge that is not only rent a Zahlung', async () => {
		await pay('2026-03-04');
		await postCharge(db, contextA, {
			leaseId,
			kind: 'statement_balance',
			period: '2026-03',
			dueDate: '2026-03-04',
			amount: 12000
		});
		// Rent and Nachzahlung fall due the same day; 800 € paid leave 120 € of that day open.
		expect(await at('2026-03-10')).toEqual([
			expect.objectContaining({ title: 'Rückstand', date: '2026-03-04' })
		]);
		await postCharge(db, contextA, {
			leaseId,
			kind: 'statement_balance',
			period: '2026-03',
			dueDate: '2026-03-12',
			amount: 30000
		});
		const [entry] = await at('2026-03-16');
		expect(entry).toMatchObject({ title: 'Zahlung ausgeblieben', date: '2026-03-12' });
		expect(entry.description).toContain('Insgesamt offen: 420,00');
	});

	it('counts a Bankabruf as bank data up to its day', async () => {
		const id = await bankAccount();
		await booking(id, '2026-02-20', 'unmatched');
		await booking(id, '2026-02-21', 'unmatched');
		expect(await at('2026-03-10')).toEqual([]);
		await db.insert(bankConnections).values({
			accountId: 'a',
			bankAccountId: id,
			aspspName: 'Testbank',
			aspspCountry: 'DE',
			sessionId: 's',
			accountUid: 'u',
			lastSyncedAt: new Date('2026-03-09T23:30:00Z')
		});
		const [entry] = await at('2026-03-10');
		expect(entry.description).toContain('2 Bankumsätze sind noch nicht zugeordnet');
	});

	it('is found behind the link to snooze it', async () => {
		vi.setSystemTime(new Date('2026-03-10T10:00:00Z'));
		const entry = await findEntry(db, 'a', `arrears-${leaseId}`, '', '2026-03-10');
		expect(entry).toMatchObject({ kind: 'arrears', date: '2026-03-04' });
	});
});
