import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseExpense, parseExpenseAssignment } from '../forms/expenses';
import { loadAnalysis } from './analysis';
import { createBankAccount } from './bank/accounts';
import {
	assignExpense,
	expenseByCounterpart,
	expensePreset,
	getTransaction,
	listAssignments,
	undoAssignment
} from './bank/transactions';
import type { Database } from './db';
import {
	auditLog,
	bankTransactions,
	depositTransactions,
	expenses,
	payments,
	units
} from './db/schema';
import {
	createExpense,
	deleteExpense,
	expenseSuggestions,
	listExpenses,
	scopeOptions,
	updateExpense
} from './expenses';
import { deleteProperty, deleteUnit } from './deletion';
import { createServiceProvider, deleteServiceProvider } from './service-providers';
import { contextA, contextB, seedLease, seedUnit, testDatabase } from './testing';

let db: Database;
let propertyId: string;
let unitId: string;
let foreignUnitId: string;

function form(values: Record<string, string>): FormData {
	const data = new FormData();
	for (const [name, value] of Object.entries(values)) data.set(name, value);
	return data;
}

const bankAccountIds: Record<string, string> = {};

async function seedTransaction(
	accountId: string,
	amount: number,
	counterpart: { counterpartName?: string; counterpartIban?: string } = {}
): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(bankTransactions).values({
		id,
		accountId,
		bankAccountId: bankAccountIds[accountId],
		bookingDate: '2026-03-05',
		amount,
		counterpartName: 'Sanitär Meier',
		purpose: 'Rechnung 4711',
		fingerprint: id,
		...counterpart
	});
	return id;
}

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
	({ unitId: foreignUnitId } = await seedUnit(db, 'b'));
	for (const context of [contextA, contextB]) {
		const bank = await createBankAccount(db, context, {
			name: 'Mietkonto',
			iban: 'DE02120300000000202051',
			bic: null,
			holder: 'Oliver'
		});
		if (!bank.ok) throw new Error('setup failed');
		bankAccountIds[context.accountId] = bank.id;
	}
});

describe('expense forms', () => {
	it('parses a manual expense with its scope', () => {
		const result = parseExpense(
			form({
				date: '2026-03-05',
				amount: '1.250,00',
				category: 'maintenance',
				scope: `unit:${unitId}`,
				description: 'Bad'
			})
		);
		expect(result).toMatchObject({
			ok: true,
			data: { amount: 125000, scope: { kind: 'unit', id: unitId }, category: 'maintenance' }
		});
	});

	it('refuses an unknown category, a bad scope and a zero amount', () => {
		const result = parseExpense(
			form({
				date: '2026-03-05',
				amount: '0',
				category: 'yacht',
				scope: 'tenant:x',
				description: ''
			})
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual([
			'amount',
			'category',
			'description',
			'scope'
		]);
	});

	it('treats an empty scope as the portfolio', () => {
		const result = parseExpenseAssignment(
			form({ category: 'management', scope: '', description: 'Steuerberatung' })
		);
		expect(result).toMatchObject({ ok: true, data: { scope: { kind: 'portfolio' } } });
	});
});

describe('expenses', () => {
	it('creates, lists and deletes a manual expense with an audit line', async () => {
		const created = await createExpense(db, contextA, {
			date: '2026-03-05',
			amount: 125000,
			category: 'maintenance',
			scope: { kind: 'unit', id: unitId },
			description: 'Bad'
		});
		if (!created.ok) throw new Error('not created');
		const [row] = await listExpenses(db, 'a', { from: '2026-01-01', to: '2026-12-31' });
		expect(row).toMatchObject({
			propertyId,
			unitId,
			amount: 125000,
			scopeLabel: 'EG links · Haus'
		});
		expect(await listExpenses(db, 'a', { from: '2025-01-01', to: '2025-12-31' })).toEqual([]);
		expect(await listExpenses(db, 'b')).toEqual([]);

		expect(await deleteExpense(db, contextB, created.id)).toBe('missing');
		expect(await deleteExpense(db, contextA, created.id)).toBe('deleted');
		const log = await db.select().from(auditLog).where(eq(auditLog.entity, 'expense'));
		expect(log.map((line) => line.action)).toEqual(['create', 'delete']);
	});

	it("refuses another account's unit or property", async () => {
		const input = {
			date: '2026-03-05',
			amount: 100,
			category: 'other' as const,
			description: 'x'
		};
		expect(
			await createExpense(db, contextA, { ...input, scope: { kind: 'unit', id: foreignUnitId } })
		).toEqual({
			ok: false,
			reason: 'unknown-scope'
		});
		expect(
			await createExpense(db, contextA, { ...input, scope: { kind: 'property', id: 'nope' } })
		).toEqual({ ok: false, reason: 'unknown-scope' });
	});

	it('keeps the property and unit an expense is booked on', async () => {
		await createExpense(db, contextA, {
			date: '2026-03-05',
			amount: 100,
			category: 'other',
			scope: { kind: 'unit', id: unitId },
			description: 'x'
		});
		expect(await deleteUnit(db, contextA, unitId)).toBe('in-use');
		expect(await deleteProperty(db, contextA, propertyId)).toBe('in-use');
		const [row] = await listExpenses(db, 'a');
		expect(row).toMatchObject({ propertyId, unitId });
	});

	it('offers each property with its units', async () => {
		await db.insert(units).values({ accountId: 'a', propertyId, name: 'OG', kind: 'apartment' });
		const [group] = await scopeOptions(db, 'a');
		expect(group.id).toBe(propertyId);
		expect(group.options.map((option) => option.label)).toEqual([
			'Haus (ganzes Objekt)',
			'EG links',
			'OG'
		]);
	});
	it('suggests each description once, with the category and scope it was booked with last', async () => {
		const base = { amount: 1000, scope: { kind: 'portfolio' as const } };
		await createExpense(db, contextA, {
			...base,
			date: '2026-01-10',
			category: 'other',
			description: 'Heizungswartung'
		});
		await createExpense(db, contextA, {
			...base,
			date: '2026-02-10',
			category: 'management',
			description: 'Steuerberatung'
		});
		await createExpense(db, contextA, {
			...base,
			date: '2026-03-10',
			category: 'maintenance',
			scope: { kind: 'property', id: propertyId },
			description: 'Heizungswartung'
		});
		expect(await expenseSuggestions(db, 'a')).toEqual([
			{
				description: 'Heizungswartung',
				category: 'maintenance',
				scope: `property:${propertyId}`,
				serviceProviderId: ''
			},
			{ description: 'Steuerberatung', category: 'management', scope: '', serviceProviderId: '' }
		]);
		expect(await expenseSuggestions(db, 'b')).toEqual([]);
	});
});

describe('expenses by Dienstleister', () => {
	it('names the Dienstleister or leaves it unknown, refuses one of another account and forgets a deleted one', async () => {
		const caretaker = await createServiceProvider(db, contextA, {
			name: 'Hausmeisterservice Krüger',
			service: 'Hausmeisterdienst',
			phone: null,
			email: null,
			note: null
		});
		const foreign = await createServiceProvider(db, contextB, {
			name: 'Fremd',
			service: null,
			phone: null,
			email: null,
			note: null
		});
		const input = {
			date: '2026-04-01',
			amount: 72000,
			category: 'operating_costs' as const,
			scope: { kind: 'property' as const, id: propertyId },
			description: 'Hausmeisterdienst'
		};
		expect(await createExpense(db, contextA, { ...input, serviceProviderId: foreign })).toEqual({
			ok: false,
			reason: 'unknown-service-provider'
		});
		const named = await createExpense(db, contextA, { ...input, serviceProviderId: caretaker });
		const unknown = await createExpense(db, contextA, { ...input, description: 'Bar bezahlt' });
		if (!named.ok || !unknown.ok) throw new Error('not created');
		const byId = async () =>
			new Map((await listExpenses(db, 'a')).map((row) => [row.id, row.serviceProviderName]));
		expect(await byId()).toEqual(
			new Map([
				[named.id, 'Hausmeisterservice Krüger'],
				[unknown.id, null]
			])
		);
		// A change without the field (the API) keeps the Dienstleister.
		expect(await updateExpense(db, contextA, named.id, { ...input, amount: 75000 })).toBe(
			'updated'
		);
		expect((await byId()).get(named.id)).toBe('Hausmeisterservice Krüger');
		expect(
			await updateExpense(db, contextA, named.id, { ...input, serviceProviderId: foreign })
		).toBe('unknown-service-provider');
		// Deleting the Dienstleister keeps the expense, now unknown.
		expect(await deleteServiceProvider(db, contextA, caretaker)).toBe(true);
		expect(await byId()).toEqual(
			new Map([
				[named.id, null],
				[unknown.id, null]
			])
		);
	});

	it('reads the Dienstleister from the form, empty for unknown', () => {
		const form = (serviceProviderId: string) => {
			const data = new FormData();
			data.set('category', 'other');
			data.set('description', 'x');
			data.set('serviceProviderId', serviceProviderId);
			return data;
		};
		expect(parseExpenseAssignment(form(''))).toMatchObject({
			ok: true,
			data: { serviceProviderId: null }
		});
		expect(parseExpenseAssignment(form('abc-1'))).toMatchObject({
			ok: true,
			data: { serviceProviderId: 'abc-1' }
		});
		expect(parseExpenseAssignment(form('a b'))).toMatchObject({ ok: false });
	});
});

describe('bank transactions as expenses', () => {
	it('books an outgoing transaction as an expense and undoes it again', async () => {
		const transactionId = await seedTransaction('a', -125000);
		const outcome = await assignExpense(db, contextA, transactionId, {
			category: 'maintenance',
			scope: { kind: 'property', id: propertyId },
			description: 'Sanitär Meier'
		});
		expect(outcome).toBe('assigned');
		expect((await getTransaction(db, 'a', transactionId))?.status).toBe('matched');
		const [expense] = await listExpenses(db, 'a');
		expect(expense).toMatchObject({
			amount: 125000,
			date: '2026-03-05',
			propertyId,
			unitId: null,
			bankTransactionId: transactionId
		});
		const assignments = await listAssignments(db, 'a', [transactionId]);
		expect(assignments.get(transactionId)).toEqual([
			{ kind: 'expense', id: expense.id, amount: 125000, category: 'maintenance', scope: 'Haus' }
		]);

		// Deleted on the bank page only.
		expect(await deleteExpense(db, contextA, expense.id)).toBe('from-bank');
		expect(await undoAssignment(db, contextA, transactionId)).toBe('undone');
		expect(await listExpenses(db, 'a')).toEqual([]);
		expect((await getTransaction(db, 'a', transactionId))?.status).toBe('unmatched');
	});

	it('books an incoming refund as a negative expense', async () => {
		const transactionId = await seedTransaction('a', 20000);
		await assignExpense(db, contextA, transactionId, {
			category: 'operating_costs',
			scope: { kind: 'portfolio' },
			description: 'Erstattung Versicherung'
		});
		expect((await listExpenses(db, 'a'))[0].amount).toBe(-20000);
	});

	it('assigns a transaction once and never into another account', async () => {
		const transactionId = await seedTransaction('a', -5000);
		const input = {
			category: 'other' as const,
			scope: { kind: 'portfolio' as const },
			description: 'x'
		};
		expect(await assignExpense(db, contextB, transactionId, input)).toBe('missing');
		expect(
			await assignExpense(db, contextA, transactionId, {
				...input,
				scope: { kind: 'unit', id: foreignUnitId }
			})
		).toBe('unknown-scope');
		const [first, second] = await Promise.all([
			assignExpense(db, contextA, transactionId, input),
			assignExpense(db, contextA, transactionId, input)
		]);
		expect([first, second].sort()).toEqual(['assigned', 'not-open']);
		expect(await db.select().from(expenses)).toHaveLength(1);
	});
	it('presets the next expense to a counterpart like the last one, by IBAN, else by name', async () => {
		const iban = 'DE89370400440532013000';
		const first = await seedTransaction('a', -5000, { counterpartIban: iban });
		await assignExpense(db, contextA, first, {
			category: 'other',
			scope: { kind: 'portfolio' },
			description: 'Erste Rechnung'
		});
		const second = await seedTransaction('a', -7000, { counterpartIban: iban });
		const heating = await createServiceProvider(db, contextA, {
			name: 'Heizung Aydin',
			service: 'Heizung',
			phone: null,
			email: null,
			note: null
		});
		await assignExpense(db, contextA, second, {
			category: 'maintenance',
			scope: { kind: 'unit', id: unitId },
			description: 'Heizungswartung',
			serviceProviderId: heating
		});
		const presets = await expenseByCounterpart(db, 'a');
		const latest = {
			category: 'maintenance',
			scope: `unit:${unitId}`,
			description: 'Heizungswartung',
			serviceProviderId: heating
		};
		// The IBAN wins over the name; without an IBAN the name decides, whatever its case.
		expect(expensePreset({ counterpartIban: iban, counterpartName: 'Jemand' }, presets)).toEqual(
			latest
		);
		expect(
			expensePreset({ counterpartIban: null, counterpartName: ' sanitär meier ' }, presets)
		).toEqual(latest);
		expect(
			expensePreset(
				{ counterpartIban: 'DE02120300000000202051', counterpartName: 'Fremd' },
				presets
			)
		).toBeUndefined();
		const foreign = await expenseByCounterpart(db, 'b');
		expect(foreign.byIban.size + foreign.byName.size).toBe(0);
	});
});

describe('loadAnalysis', () => {
	it('puts the rent ledger, the expenses and the arrears together', async () => {
		const leaseId = await seedLease(db, 'a', unitId, { startDate: '2026-01-01' });
		await db.insert(payments).values([
			{ accountId: 'a', leaseId, date: '2026-01-03', amount: 80000 },
			{ accountId: 'a', leaseId, date: '2026-02-03', amount: 80000 }
		]);
		await createExpense(db, contextA, {
			date: '2026-02-10',
			amount: 30000,
			category: 'maintenance',
			scope: { kind: 'unit', id: unitId },
			description: 'Therme'
		});
		await db.insert(depositTransactions).values([
			{ accountId: 'a', leaseId, date: '2026-01-05', amount: 180000, kind: 'received' },
			{ accountId: 'a', leaseId, date: '2026-06-30', amount: -180000, kind: 'returned' }
		]);
		const page = await loadAnalysis(db, 'a', {
			period: 2026,
			propertyId: null,
			today: '2026-03-31'
		});
		expect(page.totals).toMatchObject({
			charged: 3 * 80000,
			received: 160000,
			expenses: 30000,
			net: 130000,
			vacantDays: 0,
			// The return on 30 June is still ahead on 31 March.
			depositsHeld: 180000
		});
		expect(page.arrears).toBe(80000);
		expect(page.years).toEqual([2026]);
		expect(page.series).toHaveLength(12);
		expect(page.units[0]).toMatchObject({
			name: 'EG links',
			expenses: 30000,
			rentPerSqm: 600 / 64
		});

		const all = await loadAnalysis(db, 'a', {
			period: 'all',
			propertyId: null,
			today: '2026-03-31'
		});
		expect(all.series.map((point) => point.key)).toEqual(['2026']);
		const other = await loadAnalysis(db, 'b', {
			period: 2026,
			propertyId: null,
			today: '2026-03-31'
		});
		expect(other.totals.received).toBe(0);

		// A unit never let still reaches back to its creation for the vacancy history.
		await db
			.update(units)
			.set({ createdAt: new Date('2024-05-01T00:00:00Z') })
			.where(eq(units.id, foreignUnitId));
		const created = await loadAnalysis(db, 'b', {
			period: 'all',
			propertyId: null,
			today: '2026-03-31'
		});
		expect(created.years).toEqual([2026, 2025, 2024]);
		expect(created.totals.vacantDays).toBe(700);
	});

	it('counts a parking space let with the flat from the lease start, even if entered later', async () => {
		// The flat exists since 2025; the parking space was entered in 2026 but has been let with
		// the flat from January to June 2025. Both stand empty from July: 2 × 184 days.
		await db
			.update(units)
			.set({ createdAt: new Date('2025-01-01T00:00:00Z') })
			.where(eq(units.id, unitId));
		const [parking] = await db
			.insert(units)
			.values({
				accountId: 'a',
				propertyId,
				name: 'Stellplatz 1',
				kind: 'parking',
				createdAt: new Date('2026-02-01T00:00:00Z')
			})
			.returning({ id: units.id });
		await seedLease(db, 'a', unitId, {
			startDate: '2025-01-01',
			endDate: '2025-06-30',
			extraUnitIds: [parking.id]
		});
		const page = await loadAnalysis(db, 'a', {
			period: 2025,
			propertyId: null,
			today: '2026-03-31'
		});
		expect(page.totals.vacantDays).toBe(2 * 184);
	});
});
