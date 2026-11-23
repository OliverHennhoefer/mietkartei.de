import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseBankFile } from '../../domain/bank-matching';
import type { Database } from '../db';
import type { ExpenseCategory } from '../db/schema';
import {
	depositTransactions,
	expenses,
	matchingRules,
	otherBookings,
	payments,
	rentCharges
} from '../db/schema';
import { createLease } from '../leases';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from '../testing';
import { createBankAccount } from './accounts';
import {
	contraAccountTotals,
	createContraAccount,
	deleteContraAccount,
	listContraAccounts,
	updateContraAccount
} from './contra-accounts';
import { commitImport } from './imports';
import { listRules } from './rules';
import {
	assignExpense,
	assignOther,
	assignTransaction,
	expenseByCounterpart,
	expensePreset,
	listAssignments,
	listTransactions,
	undoAssignment
} from './transactions';

// Miete 850 € from Müller, Grundsteuer to the town, interest from the bank and a Privatentnahme.
const statement = (lines: string[]) =>
	[
		'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
		...lines
	].join('\n');
const line = (day: string, purpose: string, name: string, iban: string, amount: string) =>
	`DE02120300000000202051;${day};${day};X;${purpose};;;;;;;${name};${iban};INGDDEFFXXX;${amount};EUR;Umsatz gebucht`;
const rent = line('01.10.26', 'Miete Oktober', 'Max Müller', 'DE12500105175407324931', '800,00');
const tax = line('15.10.26', 'Grundsteuer Q4', 'Stadtkasse', 'DE89370400440532013000', '-210,00');
const interest = line('30.10.26', 'Zinsen', 'Bank', 'DE75512108001245126199', '3,12');
const privat = line('31.10.26', 'Umbuchung', 'Oliver', 'DE91100000000123456789', '-500,00');

let db: Database;
let leaseId: string;
let propertyId: string;
let bankAccountId: string;

beforeEach(async () => {
	db = await testDatabase();
	const unit = await seedUnit(db, 'a');
	propertyId = unit.propertyId;
	await seedUnit(db, 'b');
	const tenantId = await seedTenant(db, 'a', { lastName: 'Müller' });
	const lease = await createLease(db, contextA, leaseInput(unit.unitId, { tenantIds: [tenantId] }));
	if (!lease.ok) throw new Error('setup failed');
	leaseId = lease.id;
	const bank = await createBankAccount(db, contextA, {
		name: 'Mietkonto',
		iban: 'DE02120300000000202051',
		bic: null,
		holder: 'Oliver',
		ledgerNumber: '1200'
	});
	if (!bank.ok) throw new Error('setup failed');
	bankAccountId = bank.id;
});

async function account(
	number: string,
	name: string,
	kind: Parameters<typeof createContraAccount>[2]['kind'],
	extra: { expenseCategory?: ExpenseCategory | null; propertyId?: string | null } = {}
) {
	const created = await createContraAccount(db, contextA, {
		number: number || null,
		name,
		kind,
		expenseCategory: extra.expenseCategory ?? null,
		propertyId: extra.propertyId ?? null
	});
	if (!created.ok) throw new Error(created.reason);
	return created.id;
}

async function importLines(...lines: string[]) {
	const parsed = parseBankFile(statement(lines));
	if (!parsed) throw new Error('no table');
	const result = await commitImport(db, contextA, bankAccountId, 'umsatz.csv', parsed.results);
	if (!result) throw new Error('import failed');
	return result;
}

async function open() {
	return (await listTransactions(db, 'a', { status: 'unmatched' })).rows;
}

describe('Gegenkonten', () => {
	it('lists by number and refuses a number twice or a foreign property', async () => {
		await account('8005', 'Mieten Haus', 'rent');
		await account('1800', 'Privatentnahmen', 'private');
		await account('', 'Ohne Nummer', 'other_income');
		expect((await listContraAccounts(db, 'a')).map((row) => row.number ?? row.name)).toEqual([
			'1800',
			'8005',
			'Ohne Nummer'
		]);
		const input = {
			number: '8005',
			name: 'Doppelt',
			kind: 'rent' as const,
			expenseCategory: null,
			propertyId: null
		};
		expect(await createContraAccount(db, contextA, input)).toEqual({
			ok: false,
			reason: 'duplicate-number'
		});
		const [foreign] = await listContraAccounts(db, 'b');
		expect(foreign).toBeUndefined();
		expect(await createContraAccount(db, contextB, { ...input, number: '1', propertyId })).toEqual({
			ok: false,
			reason: 'unknown-property'
		});
	});

	it('keeps what was booked when a Gegenkonto is changed or deleted, and drops its rules', async () => {
		const water = await account('4403', 'Wasser', 'expense', {
			expenseCategory: 'operating_costs'
		});
		await importLines(tax);
		const [transaction] = await open();
		await assignExpense(db, contextA, transaction.id, {
			category: null,
			scope: { kind: 'portfolio' },
			description: 'Grundsteuer',
			contraAccountId: water
		});
		expect(await listRules(db, 'a')).toHaveLength(1);
		const changed = await updateContraAccount(db, contextA, water, {
			number: '4401',
			name: 'Grundsteuer',
			kind: 'expense',
			expenseCategory: 'operating_costs',
			propertyId
		});
		expect(changed).toEqual({ ok: true });
		expect(await deleteContraAccount(db, contextB, water)).toBe(false);
		expect(await deleteContraAccount(db, contextA, water)).toBe(true);
		const [expense] = await db.select().from(expenses);
		expect(expense).toMatchObject({ amount: 21000, contraAccountId: null });
		expect(await db.select().from(matchingRules)).toEqual([]);
	});
});

describe('booking to Gegenkonten', () => {
	it("splits rent into Kaltmiete and Nebenkosten on the property's accounts", async () => {
		const rentAccount = await account('8005', 'Mieten Haus', 'rent', { propertyId });
		const costs = await account('8006', 'NK Haus', 'operating_costs', { propertyId });
		await account('8000', 'Mieten allgemein', 'rent');
		await importLines(rent);
		const [transaction] = await open();
		const outcome = await assignTransaction(db, contextA, transaction.id, {
			target: 'rent',
			parts: [{ leaseId, amount: 80000 }]
		});
		expect(outcome).toBe('assigned');
		const rows = await db.select().from(payments).where(eq(payments.leaseId, leaseId));
		expect(rows.map((row) => [row.amount, row.contraAccountId]).sort()).toEqual(
			[
				[60000, rentAccount],
				[20000, costs]
			].sort()
		);
		const assignments = await listAssignments(db, 'a', [transaction.id]);
		expect(assignments.get(transaction.id)).toHaveLength(2);
		// The remembered rule is named after the payer.
		expect((await listRules(db, 'a')).map((rule) => rule.name)).toEqual(['Miete Max Müller']);
	});

	it('books a Nachzahlung to Nebenkosten Vorjahr and a deposit to the Kaution account', async () => {
		const previous = await account('8004', 'NK Vorjahr', 'statement_balance');
		const deposit = await account('3790', 'Kautionen', 'deposit');
		await db.insert(rentCharges).values({
			accountId: 'a',
			leaseId,
			period: '2026-08',
			amount: 80000,
			kind: 'statement_balance'
		});
		await importLines(
			rent,
			line('02.10.26', 'Kaution', 'Max Müller', 'DE12500105175407324931', '1800,00')
		);
		const [kaution, miete] = await open();
		await assignTransaction(db, contextA, miete.id, {
			target: 'rent',
			parts: [{ leaseId, amount: 80000 }]
		});
		await assignTransaction(db, contextA, kaution.id, {
			target: 'deposit',
			parts: [{ leaseId, amount: 180000 }]
		});
		const [payment] = await db.select().from(payments).where(eq(payments.leaseId, leaseId));
		expect(payment).toMatchObject({ amount: 80000, contraAccountId: previous });
		const [movement] = await db.select().from(depositTransactions);
		expect(movement.contraAccountId).toBe(deposit);
	});

	it('books an expense by its Gegenkonto: category and property from it', async () => {
		const grundsteuer = await account('4401', 'Grundsteuer', 'expense', {
			expenseCategory: 'operating_costs',
			propertyId
		});
		await importLines(tax);
		const [transaction] = await open();
		expect(
			await assignExpense(db, contextA, transaction.id, {
				category: null,
				scope: { kind: 'portfolio' },
				description: 'Grundsteuer Q4',
				contraAccountId: grundsteuer
			})
		).toBe('assigned');
		const [expense] = await db.select().from(expenses);
		expect(expense).toMatchObject({
			amount: 21000,
			category: 'operating_costs',
			propertyId,
			contraAccountId: grundsteuer
		});
		const rules = await listRules(db, 'a');
		expect(rules).toMatchObject([
			{ name: '4401 Grundsteuer', contraAccountId: grundsteuer, leaseId: null, confirmed: true }
		]);
	});

	it('refuses an expense on a Gegenkonto of another kind or account', async () => {
		const privat = await account('1800', 'Privat', 'private');
		await importLines(tax);
		const [transaction] = await open();
		const input = {
			category: null,
			scope: { kind: 'portfolio' as const },
			description: 'x',
			contraAccountId: privat
		};
		expect(await assignExpense(db, contextA, transaction.id, input)).toBe('unknown-contra-account');
		expect(await assignExpense(db, contextB, transaction.id, input)).toBe('missing');
	});

	it('books interest and a Privatentnahme as other bookings and undoes them', async () => {
		const capital = await account('1890', 'Kapitalerträge', 'capital_income');
		await importLines(interest, privat);
		const [entnahme, zinsen] = await open();
		expect(
			await assignOther(db, contextA, zinsen.id, {
				kind: null,
				contraAccountId: capital,
				propertyId: null,
				description: 'Zinsen'
			})
		).toBe('assigned');
		expect(
			await assignOther(db, contextA, entnahme.id, {
				kind: 'private',
				contraAccountId: null,
				propertyId,
				description: ''
			})
		).toBe('assigned');
		const rows = await db.select().from(otherBookings);
		expect(rows.map((row) => [row.kind, row.amount, row.contraAccountId]).sort()).toEqual(
			[
				['capital_income', 312, capital],
				['private', -50000, null]
			].sort()
		);
		expect((await listAssignments(db, 'a', [zinsen.id])).get(zinsen.id)).toMatchObject([
			{ kind: 'other', otherKind: 'capital_income', amount: 312, contraAccountId: capital }
		]);
		expect(await undoAssignment(db, contextA, zinsen.id)).toBe('undone');
		expect(
			await db.select().from(otherBookings).where(eq(otherBookings.bankTransactionId, zinsen.id))
		).toEqual([]);
		expect(
			await assignOther(db, contextA, entnahme.id, {
				kind: 'private',
				contraAccountId: null,
				propertyId: null,
				description: ''
			})
		).toBe('not-open');
	});
});

describe('rules on Gegenkonten', () => {
	it('books the next transfer of a remembered counterpart on import, either direction', async () => {
		const grundsteuer = await account('4401', 'Grundsteuer', 'expense', {
			expenseCategory: 'operating_costs'
		});
		const capital = await account('1890', 'Kapitalerträge', 'capital_income');
		await importLines(tax, interest);
		const [zinsen, steuer] = await open();
		await assignExpense(db, contextA, steuer.id, {
			category: null,
			scope: { kind: 'portfolio' },
			description: 'Grundsteuer',
			contraAccountId: grundsteuer
		});
		await assignOther(db, contextA, zinsen.id, {
			kind: null,
			contraAccountId: capital,
			propertyId: null,
			description: ''
		});
		const result = await importLines(
			line('15.11.26', 'Grundsteuer Q1', 'Stadtkasse', 'DE89370400440532013000', '-210,00'),
			line('30.11.26', 'Zinsen', 'Bank', 'DE75512108001245126199', '2,98')
		);
		expect(result).toMatchObject({ imported: 2, assigned: 2 });
		expect(await open()).toEqual([]);
		const booked = await db
			.select()
			.from(expenses)
			.where(and(eq(expenses.contraAccountId, grundsteuer), eq(expenses.date, '2026-11-15')));
		expect(booked).toMatchObject([{ amount: 21000, category: 'operating_costs' }]);
		const other = await db.select().from(otherBookings).where(eq(otherBookings.date, '2026-11-30'));
		expect(other).toMatchObject([
			{ kind: 'capital_income', amount: 298, contraAccountId: capital }
		]);
	});

	it('demotes a Gegenkonto rule when the counterpart is booked elsewhere', async () => {
		const water = await account('4403', 'Wasser/Müll', 'expense', {
			expenseCategory: 'operating_costs'
		});
		const grundsteuer = await account('4401', 'Grundsteuer', 'expense', {
			expenseCategory: 'operating_costs'
		});
		await importLines(
			tax,
			line('16.10.26', 'Abfall', 'Stadtkasse', 'DE89370400440532013000', '-80,00')
		);
		const [abfall, steuer] = await open();
		const book = (id: string, contraAccountId: string) =>
			assignExpense(db, contextA, id, {
				category: null,
				scope: { kind: 'portfolio' },
				description: 'x',
				contraAccountId
			});
		await book(steuer.id, grundsteuer);
		await book(abfall.id, water);
		expect(await listRules(db, 'a')).toMatchObject([
			{ contraAccountId: grundsteuer, confirmed: false }
		]);
	});
});

describe('splitting an expense', () => {
	const hausgeld = line(
		'03.10.26',
		'Hausgeld Oktober',
		'WEG Lindenstr',
		'DE44500105175407324931',
		'-450,00'
	);

	it('books Hausgeld on three accounts and offers the split again next month', async () => {
		const costs = await account('4402', 'Hausgeld umlagefähig', 'expense', {
			expenseCategory: 'operating_costs'
		});
		const reserve = await account('4416', 'Rücklage', 'expense', {
			expenseCategory: 'special_levy_reserve'
		});
		await importLines(hausgeld);
		const [transaction] = await open();
		const input = {
			category: null,
			scope: { kind: 'portfolio' as const },
			description: 'Hausgeld',
			contraAccountId: costs
		};
		expect(
			await assignExpense(db, contextA, transaction.id, {
				...input,
				splits: [{ amount: 45000, category: 'association_fee' }]
			})
		).toBe('split-too-large');
		expect(
			await assignExpense(db, contextA, transaction.id, {
				...input,
				splits: [{ amount: 100, contraAccountId: crypto.randomUUID() }]
			})
		).toBe('unknown-contra-account');
		expect(
			await assignExpense(db, contextA, transaction.id, {
				...input,
				splits: [
					{ amount: 9000, contraAccountId: reserve },
					{ amount: 6000, category: 'association_fee' }
				]
			})
		).toBe('assigned');
		const rows = await db.select().from(expenses);
		expect(rows.map((row) => [row.amount, row.category, row.contraAccountId]).sort()).toEqual(
			[
				[30000, 'operating_costs', costs],
				[9000, 'special_levy_reserve', reserve],
				[6000, 'association_fee', null]
			].sort()
		);
		expect((await listAssignments(db, 'a', [transaction.id])).get(transaction.id)).toHaveLength(3);
		// A split is no single target, so no rule books it on its own.
		expect(await listRules(db, 'a')).toEqual([]);

		const presets = await expenseByCounterpart(db, 'a');
		expect(
			expensePreset({ counterpartIban: 'DE44500105175407324931', counterpartName: '' }, presets)
		).toMatchObject({
			contraAccountId: costs,
			splits: [
				{ amount: 9000, contraAccountId: reserve },
				{ amount: 6000, category: 'association_fee' }
			]
		});

		expect(await undoAssignment(db, contextA, transaction.id)).toBe('undone');
		expect(await db.select().from(expenses)).toEqual([]);
	});

	it('splits a Darlehensrate into interest and repayment', async () => {
		await importLines(
			line('30.10.26', 'Darlehen 4711', 'Sparkasse', 'DE02100500000024290661', '-1200,00')
		);
		const [transaction] = await open();
		expect(
			await assignExpense(db, contextA, transaction.id, {
				category: 'loan_repayment',
				scope: { kind: 'property', id: propertyId },
				description: 'Darlehen 4711',
				splits: [{ amount: 38050, category: 'loan_interest' }]
			})
		).toBe('assigned');
		const rows = await db.select().from(expenses);
		expect(rows.map((row) => [row.category, row.amount, row.propertyId]).sort()).toEqual(
			[
				['loan_interest', 38050, propertyId],
				['loan_repayment', 81950, propertyId]
			].sort()
		);
	});
});

describe('contraAccountTotals', () => {
	it('sums the bookings of a year per Gegenkonto, as the bank sees them', async () => {
		const rentAccount = await account('8005', 'Mieten', 'rent');
		const costs = await account('8006', 'NK', 'operating_costs');
		const taxAccount = await account('4401', 'Grundsteuer', 'expense', {
			expenseCategory: 'operating_costs'
		});
		await importLines(rent, tax, interest);
		const rows = await open();
		const find = (purpose: string) => rows.find((row) => row.purpose === purpose)!.id;
		await assignTransaction(db, contextA, find('Miete Oktober'), {
			target: 'rent',
			parts: [{ leaseId, amount: 80000 }]
		});
		await assignExpense(db, contextA, find('Grundsteuer Q4'), {
			category: null,
			scope: { kind: 'portfolio' },
			description: 'Grundsteuer',
			contraAccountId: taxAccount
		});
		await assignOther(db, contextA, find('Zinsen'), {
			kind: 'capital_income',
			contraAccountId: null,
			propertyId: null,
			description: ''
		});
		const totals = await contraAccountTotals(db, 'a', 2026);
		expect(Object.fromEntries(totals)).toEqual({
			[rentAccount]: { amount: 60000, count: 1 },
			[costs]: { amount: 20000, count: 1 },
			[taxAccount]: { amount: -21000, count: 1 },
			null: { amount: 312, count: 1 }
		});
		expect((await contraAccountTotals(db, 'a', 2025)).size).toBe(0);
		expect((await contraAccountTotals(db, 'b', 2026)).size).toBe(0);
	});
});
