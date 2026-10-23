import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseExpense, parseExpenseAssignment } from '../forms/expenses';
import { loadAnalysis } from './analysis';
import { createBankAccount } from './bank/accounts';
import {
	assignExpense,
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
import { createExpense, deleteExpense, listExpenses, scopeOptions } from './expenses';
import { deleteProperty } from './properties';
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

async function seedTransaction(accountId: string, amount: number): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(bankTransactions).values({
		id,
		accountId,
		bankAccountId: bankAccountIds[accountId],
		bookingDate: '2026-03-05',
		amount,
		counterpartName: 'Sanitär Meier',
		purpose: 'Rechnung 4711',
		fingerprint: id
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

	it('keeps the expense when its property is deleted, as one of the whole portfolio', async () => {
		await createExpense(db, contextA, {
			date: '2026-03-05',
			amount: 100,
			category: 'other',
			scope: { kind: 'unit', id: unitId },
			description: 'x'
		});
		expect(await deleteProperty(db, contextA, propertyId)).toBe('deleted');
		const [row] = await listExpenses(db, 'a');
		expect(row).toMatchObject({ propertyId: null, unitId: null, scopeLabel: 'Gesamter Bestand' });
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
	});
});
