import { and, asc, count, eq, getTableColumns, ne } from 'drizzle-orm';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import { allocationKeys, billingCircles, costCategories, costItems } from '../db/schema';

// Kostenarten: which costs exist, whether they may be passed on, and the key and circle a new
// cost item of the category starts with. The standard list is seeded by defaults.ts.

export type CostCategory = typeof costCategories.$inferSelect;

export type CostCategoryInput = {
	name: string;
	betrkvItem: number | null;
	allocable: boolean;
	consumptionBased: boolean;
	allocationKeyId: string | null;
	billingCircleId: string | null;
	sortOrder: number;
};

export type CostCategoryWithUsage = CostCategory & {
	/** How many cost items use the category; they block its deletion. */
	costItemCount: number;
};

export type CategoryError = 'missing' | 'duplicate-name' | 'unknown-key' | 'unknown-circle';

function withUsage(db: Database, accountId: string, categoryId?: string) {
	const conditions = [eq(costCategories.accountId, accountId)];
	if (categoryId !== undefined) conditions.push(eq(costCategories.id, categoryId));
	return db
		.select({ ...getTableColumns(costCategories), costItemCount: count(costItems.id) })
		.from(costCategories)
		.leftJoin(costItems, eq(costItems.categoryId, costCategories.id))
		.where(and(...conditions))
		.groupBy(costCategories.id)
		.orderBy(
			asc(costCategories.sortOrder),
			asc(costCategories.name),
			asc(costCategories.createdAt)
		);
}

/** The categories of the account in their sort order, each with its cost item count. */
export async function listCategories(
	db: Database,
	accountId: string
): Promise<CostCategoryWithUsage[]> {
	return withUsage(db, accountId);
}

export async function getCategory(
	db: Database,
	accountId: string,
	categoryId: string
): Promise<CostCategoryWithUsage | undefined> {
	const [row] = await withUsage(db, accountId, categoryId);
	return row;
}

/** Whether the key and circle of the input exist in the account; the name must be free. */
async function checkInput(
	db: Database,
	accountId: string,
	input: CostCategoryInput,
	exceptId?: string
): Promise<CategoryError | undefined> {
	const conditions = [eq(costCategories.accountId, accountId), eq(costCategories.name, input.name)];
	if (exceptId) conditions.push(ne(costCategories.id, exceptId));
	const [taken] = await db
		.select({ id: costCategories.id })
		.from(costCategories)
		.where(and(...conditions));
	if (taken) return 'duplicate-name';
	if (input.allocationKeyId) {
		const [key] = await db
			.select({ id: allocationKeys.id })
			.from(allocationKeys)
			.where(
				and(eq(allocationKeys.accountId, accountId), eq(allocationKeys.id, input.allocationKeyId))
			);
		if (!key) return 'unknown-key';
	}
	if (input.billingCircleId) {
		const [circle] = await db
			.select({ id: billingCircles.id })
			.from(billingCircles)
			.where(
				and(eq(billingCircles.accountId, accountId), eq(billingCircles.id, input.billingCircleId))
			);
		if (!circle) return 'unknown-circle';
	}
	return undefined;
}

export async function createCategory(
	db: Database,
	context: AuditContext,
	input: CostCategoryInput
): Promise<{ ok: true; id: string } | { ok: false; reason: CategoryError }> {
	const { accountId } = context;
	const reason = await checkInput(db, accountId, input);
	if (reason) return { ok: false, reason };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(costCategories).values({ id, accountId, ...input }),
		auditEntry(db, context, 'cost_category', id, 'create', `Kostenart ${input.name} angelegt`)
	]);
	return { ok: true, id };
}

export async function updateCategory(
	db: Database,
	context: AuditContext,
	categoryId: string,
	input: CostCategoryInput
): Promise<{ ok: true } | { ok: false; reason: CategoryError }> {
	const { accountId } = context;
	const existing = await getCategory(db, accountId, categoryId);
	if (!existing) return { ok: false, reason: 'missing' };
	const reason = await checkInput(db, accountId, input, categoryId);
	if (reason) return { ok: false, reason };
	await runBatch(db, [
		db
			.update(costCategories)
			.set(input)
			.where(and(eq(costCategories.accountId, accountId), eq(costCategories.id, categoryId))),
		auditEntry(
			db,
			context,
			'cost_category',
			categoryId,
			'update',
			`Kostenart ${input.name} geändert`
		)
	]);
	return { ok: true };
}

/** A category with cost items stays: the items keep their history. */
export async function deleteCategory(
	db: Database,
	context: AuditContext,
	categoryId: string
): Promise<'deleted' | 'in-use' | 'missing'> {
	const { accountId } = context;
	const existing = await getCategory(db, accountId, categoryId);
	if (!existing) return 'missing';
	if (existing.costItemCount > 0) return 'in-use';
	await runBatch(db, [
		db
			.delete(costCategories)
			.where(and(eq(costCategories.accountId, accountId), eq(costCategories.id, categoryId))),
		auditEntry(
			db,
			context,
			'cost_category',
			categoryId,
			'delete',
			`Kostenart ${existing.name} gelöscht`
		)
	]);
	return 'deleted';
}
