import { and, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { formatDate } from '../dates';
import { reconcileAssociation, type AssociationReconciliation } from '../domain/association';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { associationStatements, costItems, expenses, properties, units } from './db/schema';
import { assertQuota } from './quotas';

// Hausgeldabrechnungen of an Eigentumswohnung: the Verwalter's figures for a Wirtschaftsjahr,
// reconciled on every read against the Hausgeld paid (expenses of category association_fee for
// the property or one of its units) and the Belege with the figures of the WEG.

export type AssociationStatementInput = {
	periodStart: string;
	periodEnd: string;
	allocableCosts: number;
	nonAllocableCosts: number;
	reserveContribution: number;
	reserveWithdrawal: number;
	feesDue: number;
	statedBalance: number | null;
	note: string | null;
};

export type AssociationStatement = typeof associationStatements.$inferSelect;

export type ReconciledAssociationStatement = AssociationStatement & AssociationReconciliation;

export type AssociationStatementError = 'missing' | 'unknown-property' | 'duplicate-period';

function statementLabel(statement: { periodStart: string; periodEnd: string }): string {
	return `Hausgeldabrechnung ${formatDate(statement.periodStart)} – ${formatDate(statement.periodEnd)}`;
}

/** The Hausgeld paid for the property (or one of its units) in the period. */
async function feesPaid(
	db: Database,
	accountId: string,
	propertyId: string,
	statement: { periodStart: string; periodEnd: string }
): Promise<number> {
	const unitIds = db
		.select({ id: units.id })
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)));
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
		.from(expenses)
		.where(
			and(
				eq(expenses.accountId, accountId),
				eq(expenses.category, 'association_fee'),
				or(eq(expenses.propertyId, propertyId), inArray(expenses.unitId, unitIds)),
				gte(expenses.date, statement.periodStart),
				lte(expenses.date, statement.periodEnd)
			)
		);
	return Number(row?.total ?? 0);
}

/** The Belege of the property with the figures of the WEG that overlap the period. */
function associationItems(
	db: Database,
	accountId: string,
	propertyId: string,
	statement: { periodStart: string; periodEnd: string }
) {
	return db
		.select({
			periodStart: costItems.periodStart,
			periodEnd: costItems.periodEnd,
			amount: costItems.amount,
			allocable: costItems.allocable
		})
		.from(costItems)
		.where(
			and(
				eq(costItems.accountId, accountId),
				eq(costItems.propertyId, propertyId),
				isNotNull(costItems.associationTotal),
				lte(costItems.periodStart, statement.periodEnd),
				gte(costItems.periodEnd, statement.periodStart)
			)
		);
}

async function reconcile(
	db: Database,
	accountId: string,
	statement: AssociationStatement
): Promise<ReconciledAssociationStatement> {
	const [paid, items] = await Promise.all([
		feesPaid(db, accountId, statement.propertyId, statement),
		associationItems(db, accountId, statement.propertyId, statement)
	]);
	return { ...statement, ...reconcileAssociation(statement, paid, items) };
}

/** The Hausgeldabrechnungen of the property, newest first, each reconciled. */
export async function listAssociationStatements(
	db: Database,
	accountId: string,
	propertyId?: string
): Promise<ReconciledAssociationStatement[]> {
	const rows = await db
		.select()
		.from(associationStatements)
		.where(
			and(
				eq(associationStatements.accountId, accountId),
				propertyId ? eq(associationStatements.propertyId, propertyId) : undefined
			)
		)
		.orderBy(desc(associationStatements.periodStart));
	return Promise.all(rows.map((row) => reconcile(db, accountId, row)));
}

export async function getAssociationStatement(
	db: Database,
	accountId: string,
	id: string
): Promise<ReconciledAssociationStatement | undefined> {
	const [row] = await db
		.select()
		.from(associationStatements)
		.where(and(eq(associationStatements.accountId, accountId), eq(associationStatements.id, id)));
	return row ? reconcile(db, accountId, row) : undefined;
}

/** Whether another Hausgeldabrechnung of the property starts on the same day. */
async function periodTaken(
	db: Database,
	accountId: string,
	propertyId: string,
	periodStart: string,
	exceptId?: string
): Promise<boolean> {
	const [row] = await db
		.select({ id: associationStatements.id })
		.from(associationStatements)
		.where(
			and(
				eq(associationStatements.accountId, accountId),
				eq(associationStatements.propertyId, propertyId),
				eq(associationStatements.periodStart, periodStart),
				exceptId ? ne(associationStatements.id, exceptId) : undefined
			)
		);
	return Boolean(row);
}

export async function createAssociationStatement(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: AssociationStatementInput
): Promise<{ ok: true; id: string } | { ok: false; reason: AssociationStatementError }> {
	const { accountId } = context;
	const [property] = await db
		.select({ id: properties.id })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return { ok: false, reason: 'unknown-property' };
	if (await periodTaken(db, accountId, propertyId, input.periodStart)) {
		return { ok: false, reason: 'duplicate-period' };
	}
	await assertQuota(db, accountId, 'associationStatements');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(associationStatements).values({ id, accountId, propertyId, ...input }),
		auditEntry(
			db,
			context,
			'association_statement',
			id,
			'create',
			`${statementLabel(input)} erfasst`
		)
	]);
	return { ok: true, id };
}

export async function updateAssociationStatement(
	db: Database,
	context: AuditContext,
	id: string,
	input: AssociationStatementInput
): Promise<{ ok: true } | { ok: false; reason: AssociationStatementError }> {
	const { accountId } = context;
	const existing = await getAssociationStatement(db, accountId, id);
	if (!existing) return { ok: false, reason: 'missing' };
	if (await periodTaken(db, accountId, existing.propertyId, input.periodStart, id)) {
		return { ok: false, reason: 'duplicate-period' };
	}
	await runBatch(db, [
		db
			.update(associationStatements)
			.set(input)
			.where(and(eq(associationStatements.accountId, accountId), eq(associationStatements.id, id))),
		auditEntry(
			db,
			context,
			'association_statement',
			id,
			'update',
			`${statementLabel(input)} geändert`
		)
	]);
	return { ok: true };
}

export async function deleteAssociationStatement(
	db: Database,
	context: AuditContext,
	id: string
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getAssociationStatement(db, accountId, id);
	if (!existing) return false;
	await runBatch(db, [
		db
			.delete(associationStatements)
			.where(and(eq(associationStatements.accountId, accountId), eq(associationStatements.id, id))),
		auditEntry(
			db,
			context,
			'association_statement',
			id,
			'delete',
			`${statementLabel(existing)} gelöscht`
		)
	]);
	return true;
}
