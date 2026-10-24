import { and, desc, eq, gte, lte, min } from 'drizzle-orm';
import { formatDate } from '../dates';
import { scopeValue, type ExpenseInput, type ExpenseScope } from '../forms/expenses';
import { expenseCategoryLabels } from '../labels';
import { formatCents } from '../money';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { expenses, properties, units } from './db/schema';
import { assertQuota } from './quotas';

// Ausgaben: money the landlord paid out, for a unit, a property or the portfolio as a whole.
// Entered here by hand, or assigned from a bank transaction by the banking module (which also
// deletes them again on undo). The analysis reads them; nothing else depends on them.

export type Expense = typeof expenses.$inferSelect;

export type ExpenseRow = Expense & {
	/** "EG links · Haus", "Haus" or "Gesamter Bestand". */
	scopeLabel: string;
};

/** The property and unit columns of a scope, checked against the account. */
export type ResolvedScope = { propertyId: string | null; unitId: string | null };

export async function resolveScope(
	db: Database,
	accountId: string,
	scope: ExpenseScope
): Promise<ResolvedScope | undefined> {
	if (scope.kind === 'portfolio') return { propertyId: null, unitId: null };
	if (scope.kind === 'property') {
		const [row] = await db
			.select({ id: properties.id })
			.from(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, scope.id)));
		return row ? { propertyId: row.id, unitId: null } : undefined;
	}
	const [row] = await db
		.select({ id: units.id, propertyId: units.propertyId })
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.id, scope.id)));
	return row ? { propertyId: row.propertyId, unitId: row.id } : undefined;
}

/** The labels of every property and unit of the account; two queries. */
export async function scopeLabels(
	db: Database,
	accountId: string
): Promise<(row: ResolvedScope) => string> {
	const [propertyRows, unitRows] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name })
			.from(properties)
			.where(eq(properties.accountId, accountId)),
		db.select({ id: units.id, name: units.name }).from(units).where(eq(units.accountId, accountId))
	]);
	const propertyName = new Map(propertyRows.map((row) => [row.id, row.name]));
	const unitName = new Map(unitRows.map((row) => [row.id, row.name]));
	return (row) => {
		const property = row.propertyId ? propertyName.get(row.propertyId) : undefined;
		const unit = row.unitId ? unitName.get(row.unitId) : undefined;
		if (unit && property) return `${unit} · ${property}`;
		return property ?? 'Gesamter Bestand';
	};
}

/** The sentence of the audit log: "Ausgabe 120,00 € vom 03.05.2026 (Instandhaltung …)". */
export function expenseSummary(expense: {
	amount: number;
	date: string;
	category: Expense['category'];
}): string {
	return `Ausgabe ${formatCents(expense.amount)} vom ${formatDate(expense.date)} (${expenseCategoryLabels[expense.category]})`;
}

/** Newest first, optionally limited to a date range. */
export async function listExpenses(
	db: Database,
	accountId: string,
	range: { from?: string; to?: string } = {}
): Promise<ExpenseRow[]> {
	const [rows, label] = await Promise.all([
		db
			.select()
			.from(expenses)
			.where(
				and(
					eq(expenses.accountId, accountId),
					range.from ? gte(expenses.date, range.from) : undefined,
					range.to ? lte(expenses.date, range.to) : undefined
				)
			)
			.orderBy(desc(expenses.date), desc(expenses.createdAt)),
		scopeLabels(db, accountId)
	]);
	return rows.map((row) => ({ ...row, scopeLabel: label(row) }));
}

export async function createExpense(
	db: Database,
	context: AuditContext,
	input: ExpenseInput
): Promise<{ ok: true; id: string } | { ok: false; reason: 'unknown-scope' }> {
	const { accountId } = context;
	const scope = await resolveScope(db, accountId, input.scope);
	if (!scope) return { ok: false, reason: 'unknown-scope' };
	await assertQuota(db, accountId, 'expenses');
	const id = crypto.randomUUID();
	const row = {
		id,
		accountId,
		...scope,
		date: input.date,
		amount: input.amount,
		category: input.category,
		description: input.description
	};
	await runBatch(db, [
		db.insert(expenses).values(row),
		auditEntry(db, context, 'expense', id, 'create', `${expenseSummary(row)} erfasst`)
	]);
	return { ok: true, id };
}

/** Deletes a manual expense; one from a bank transaction is undone on the bank page instead. */
export async function deleteExpense(
	db: Database,
	context: AuditContext,
	expenseId: string
): Promise<'deleted' | 'missing' | 'from-bank'> {
	const { accountId } = context;
	const [existing] = await db
		.select()
		.from(expenses)
		.where(and(eq(expenses.accountId, accountId), eq(expenses.id, expenseId)));
	if (!existing) return 'missing';
	if (existing.bankTransactionId) return 'from-bank';
	await runBatch(db, [
		db.delete(expenses).where(and(eq(expenses.accountId, accountId), eq(expenses.id, expenseId))),
		auditEntry(db, context, 'expense', expenseId, 'delete', `${expenseSummary(existing)} gelöscht`)
	]);
	return 'deleted';
}

export type ScopeGroup = { id: string; label: string; options: { value: string; label: string }[] };

/** The entries of the scope select: one group per property, the whole property first. */
export async function scopeOptions(db: Database, accountId: string): Promise<ScopeGroup[]> {
	const [propertyRows, unitRows] = await Promise.all([
		db
			.select({ id: properties.id, name: properties.name, archivedAt: properties.archivedAt })
			.from(properties)
			.where(eq(properties.accountId, accountId))
			.orderBy(properties.name),
		db
			.select({ id: units.id, name: units.name, propertyId: units.propertyId })
			.from(units)
			.where(eq(units.accountId, accountId))
			.orderBy(units.name)
	]);
	// Archived (sold) properties come last: bills for them can still arrive after the sale.
	const ordered = [
		...propertyRows.filter((property) => !property.archivedAt),
		...propertyRows.filter((property) => property.archivedAt)
	];
	return ordered.map((property) => ({
		id: property.id,
		label: property.archivedAt ? `${property.name} (archiviert)` : property.name,
		options: [
			{ value: scopeValue('property', property.id), label: `${property.name} (ganzes Objekt)` },
			...unitRows
				.filter((unit) => unit.propertyId === property.id)
				.map((unit) => ({ value: scopeValue('unit', unit.id), label: unit.name }))
		]
	}));
}

/** An earlier description with the category and scope it was booked with last. */
export type ExpenseSuggestion = {
	description: string;
	category: Expense['category'];
	scope: string;
};

/** How many descriptions the suggestion list offers at most. */
const SUGGESTIONS = 200;

/**
 * The distinct descriptions of the account, most recent first, each with the category and
 * scope of its latest expense: picking one again fills them in. One query.
 */
export async function expenseSuggestions(
	db: Database,
	accountId: string
): Promise<ExpenseSuggestion[]> {
	const rows = await db
		.select({
			description: expenses.description,
			category: expenses.category,
			propertyId: expenses.propertyId,
			unitId: expenses.unitId
		})
		.from(expenses)
		.where(eq(expenses.accountId, accountId))
		.orderBy(desc(expenses.date), desc(expenses.createdAt));
	const result = new Map<string, ExpenseSuggestion>();
	for (const row of rows) {
		if (result.size >= SUGGESTIONS) break;
		if (result.has(row.description)) continue;
		result.set(row.description, {
			description: row.description,
			category: row.category,
			scope: expenseScopeValue(row)
		});
	}
	return [...result.values()];
}

/** The scope select's value of an expense: its unit, else its property, else the portfolio (''). */
export function expenseScopeValue(row: {
	propertyId: string | null;
	unitId: string | null;
}): string {
	if (row.unitId) return scopeValue('unit', row.unitId);
	return row.propertyId ? scopeValue('property', row.propertyId) : '';
}

/** The year of the earliest expense, null without any; for the year select. */
export async function firstExpenseYear(db: Database, accountId: string): Promise<number | null> {
	const [row] = await db
		.select({ date: min(expenses.date) })
		.from(expenses)
		.where(eq(expenses.accountId, accountId));
	return row?.date ? Number(row.date.slice(0, 4)) : null;
}
