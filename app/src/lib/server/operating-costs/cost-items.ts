import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	inArray,
	isNull,
	lte,
	or,
	sql
} from 'drizzle-orm';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from '../db/batch';
import {
	allocationKeys,
	billingCircles,
	costCategories,
	costItemUnitAmounts,
	costItems,
	documents,
	properties,
	units,
	type AllocationKeyKind,
	type Fuel
} from '../db/schema';
import { MAX_YEAR, MIN_YEAR } from '../../dates';
import { deleteDocument } from '../documents';
import { assertQuota } from '../quotas';
import type { Storage } from '../storage';
import { formatCents } from '../../money';

// Belege: an invoice or cost of a property for a period, with the category it belongs to, the
// key it is split by and, optionally, the circle of units it concerns. A direct key carries the
// per-unit amounts in cost_item_unit_amounts; the receipt is a document with costItemId.

export type CostItem = typeof costItems.$inferSelect;

export type CostItemInput = {
	propertyId: string;
	categoryId: string;
	allocationKeyId: string;
	billingCircleId: string | null;
	description: string;
	supplier: string | null;
	invoiceDate: string | null;
	periodStart: string;
	periodEnd: string;
	amount: number;
	allocable: boolean;
	fuel: Fuel | null;
	fuelKwh: number | null;
	co2Kg: number | null;
	co2Cost: number | null;
	/** For a cost of a WEG: the figures of the Hausgeldabrechnung, all or none. */
	associationTotal: number | null;
	associationKey: string | null;
	associationKeyTotal: number | null;
	associationKeyShare: number | null;
};

export type Receipt = { id: string; name: string };

export type CostItemSummary = CostItem & {
	propertyName: string;
	categoryName: string;
	categoryBetrkvItem: number | null;
	keyName: string;
	keyKind: AllocationKeyKind;
	circleName: string | null;
	receipts: Receipt[];
};

export type CostItemFilter = {
	propertyId?: string;
	/** Items whose period overlaps the calendar year. */
	year?: number;
};

export type UnitAmount = { unitId: string; amount: number };

export type CostItemError =
	'missing' | 'unknown-property' | 'unknown-category' | 'unknown-key' | 'unknown-circle';

function query(db: Database, accountId: string, filter: CostItemFilter & { id?: string }) {
	const conditions = [eq(costItems.accountId, accountId)];
	if (filter.id) conditions.push(eq(costItems.id, filter.id));
	if (filter.propertyId) conditions.push(eq(costItems.propertyId, filter.propertyId));
	if (filter.year !== undefined) {
		conditions.push(lte(costItems.periodStart, `${filter.year}-12-31`));
		conditions.push(gte(costItems.periodEnd, `${filter.year}-01-01`));
	}
	return db
		.select({
			...getTableColumns(costItems),
			propertyName: properties.name,
			categoryName: costCategories.name,
			categoryBetrkvItem: costCategories.betrkvItem,
			keyName: allocationKeys.name,
			keyKind: allocationKeys.kind,
			circleName: billingCircles.name
		})
		.from(costItems)
		.innerJoin(properties, eq(properties.id, costItems.propertyId))
		.innerJoin(costCategories, eq(costCategories.id, costItems.categoryId))
		.innerJoin(allocationKeys, eq(allocationKeys.id, costItems.allocationKeyId))
		.leftJoin(billingCircles, eq(billingCircles.id, costItems.billingCircleId))
		.where(and(...conditions))
		.orderBy(desc(costItems.invoiceDate), desc(costItems.periodStart), desc(costItems.createdAt));
}

/** The receipt documents of the given items, oldest first, as a map by item. */
async function receiptsOf(
	db: Database,
	accountId: string,
	itemIds: string[]
): Promise<Map<string, Receipt[]>> {
	const byItem = new Map<string, Receipt[]>();
	for (const ids of chunkIds(itemIds)) {
		const rows = await db
			.select({ id: documents.id, name: documents.name, costItemId: documents.costItemId })
			.from(documents)
			.where(and(eq(documents.accountId, accountId), inArray(documents.costItemId, ids)))
			.orderBy(asc(documents.createdAt), asc(documents.name));
		for (const row of rows) {
			if (!row.costItemId) continue;
			byItem.set(row.costItemId, [
				...(byItem.get(row.costItemId) ?? []),
				{ id: row.id, name: row.name }
			]);
		}
	}
	return byItem;
}

async function decorate(
	db: Database,
	accountId: string,
	rows: Omit<CostItemSummary, 'receipts'>[]
): Promise<CostItemSummary[]> {
	if (rows.length === 0) return [];
	const receipts = await receiptsOf(
		db,
		accountId,
		rows.map((row) => row.id)
	);
	return rows.map((row) => ({ ...row, receipts: receipts.get(row.id) ?? [] }));
}

/** The cost items of the account, newest invoice first, narrowed by property and year. */
export async function listCostItems(
	db: Database,
	accountId: string,
	filter: CostItemFilter = {}
): Promise<CostItemSummary[]> {
	return decorate(db, accountId, await query(db, accountId, filter));
}

export async function getCostItem(
	db: Database,
	accountId: string,
	costItemId: string
): Promise<CostItemSummary | undefined> {
	const [item] = await decorate(db, accountId, await query(db, accountId, { id: costItemId }));
	return item;
}

/** The last item of a property and category, which the next one usually repeats. */
export type LastCostItem = Pick<
	CostItem,
	| 'propertyId'
	| 'categoryId'
	| 'allocationKeyId'
	| 'billingCircleId'
	| 'description'
	| 'supplier'
	| 'amount'
	| 'periodEnd'
>;

/** What the Beleg form offers from earlier items: the texts as suggestions, the last items to copy. */
export type CostItemHistory = {
	/** Distinct, most recently used first. */
	descriptions: string[];
	suppliers: string[];
	/** The latest item per property and category (by period end). */
	last: LastCostItem[];
};

/** How many texts the suggestion lists offer at most. */
const SUGGESTIONS = 200;

/** The earlier items of the account, for the suggestions of the Beleg form. One query. */
export async function costItemHistory(db: Database, accountId: string): Promise<CostItemHistory> {
	const rows = await db
		.select({
			propertyId: costItems.propertyId,
			categoryId: costItems.categoryId,
			allocationKeyId: costItems.allocationKeyId,
			billingCircleId: costItems.billingCircleId,
			description: costItems.description,
			supplier: costItems.supplier,
			amount: costItems.amount,
			periodEnd: costItems.periodEnd
		})
		.from(costItems)
		.where(eq(costItems.accountId, accountId))
		.orderBy(desc(costItems.periodEnd), desc(costItems.createdAt));
	const descriptions = new Set<string>();
	const suppliers = new Set<string>();
	const last = new Map<string, LastCostItem>();
	for (const row of rows) {
		if (descriptions.size < SUGGESTIONS) descriptions.add(row.description);
		if (row.supplier && suppliers.size < SUGGESTIONS) suppliers.add(row.supplier);
		const key = `${row.propertyId}:${row.categoryId}`;
		if (!last.has(key)) last.set(key, row);
	}
	return { descriptions: [...descriptions], suppliers: [...suppliers], last: [...last.values()] };
}

/**
 * Every calendar year a period of the account overlaps, newest first: the years the list filter
 * finds items for. Periods are validated dates, so a range spans at most MIN_YEAR to MAX_YEAR.
 */
export async function listCostItemYears(db: Database, accountId: string): Promise<number[]> {
	const start = sql<string>`substr(${costItems.periodStart}, 1, 4)`;
	const end = sql<string>`substr(${costItems.periodEnd}, 1, 4)`;
	const rows = await db
		.select({ start, end })
		.from(costItems)
		.where(eq(costItems.accountId, accountId))
		.groupBy(start, end);
	const years = new Set<number>();
	for (const row of rows) {
		const from = Math.max(Number(row.start), MIN_YEAR);
		const to = Math.min(Number(row.end), MAX_YEAR);
		for (let year = from; year <= to; year += 1) years.add(year);
	}
	return [...years].sort((a, b) => b - a);
}

/**
 * Whether the property, category, key and circle of the input belong to the account; the key
 * must be usable for the property and the circle must be one of the property's. Returns the
 * kind of the key, which decides whether per-unit amounts apply.
 */
async function checkReferences(
	db: Database,
	accountId: string,
	input: CostItemInput
): Promise<{ keyKind: AllocationKeyKind } | { reason: CostItemError }> {
	const [property] = await db
		.select({ id: properties.id })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, input.propertyId)));
	if (!property) return { reason: 'unknown-property' };
	const [category] = await db
		.select({ id: costCategories.id })
		.from(costCategories)
		.where(and(eq(costCategories.accountId, accountId), eq(costCategories.id, input.categoryId)));
	if (!category) return { reason: 'unknown-category' };
	const [key] = await db
		.select({ kind: allocationKeys.kind })
		.from(allocationKeys)
		.where(
			and(
				eq(allocationKeys.accountId, accountId),
				eq(allocationKeys.id, input.allocationKeyId),
				or(isNull(allocationKeys.propertyId), eq(allocationKeys.propertyId, input.propertyId))
			)
		);
	if (!key) return { reason: 'unknown-key' };
	if (input.billingCircleId) {
		const [circle] = await db
			.select({ id: billingCircles.id })
			.from(billingCircles)
			.where(
				and(
					eq(billingCircles.accountId, accountId),
					eq(billingCircles.id, input.billingCircleId),
					eq(billingCircles.propertyId, input.propertyId)
				)
			);
		if (!circle) return { reason: 'unknown-circle' };
	}
	return { keyKind: key.kind };
}

/** What the audit log calls the item: description and amount. */
function itemLabel(item: Pick<CostItemInput, 'description' | 'amount'>): string {
	return `${item.description} (${formatCents(item.amount)})`;
}

export async function createCostItem(
	db: Database,
	context: AuditContext,
	input: CostItemInput
): Promise<{ ok: true; id: string } | { ok: false; reason: CostItemError }> {
	const { accountId } = context;
	await assertQuota(db, accountId, 'costItems');
	const checked = await checkReferences(db, accountId, input);
	if ('reason' in checked) return { ok: false, reason: checked.reason };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(costItems).values({ id, accountId, ...input }),
		auditEntry(db, context, 'cost_item', id, 'create', `Beleg ${itemLabel(input)} angelegt`)
	]);
	return { ok: true, id };
}

/**
 * Updates the item. Per-unit amounts belong to a direct key on one property, so they go when
 * the key is no longer direct or the property changes. Receipts move with the item to its new
 * property, so /dokumente files them where the item now is; the link to an insurance policy,
 * which belongs to the old property, goes.
 */
export async function updateCostItem(
	db: Database,
	context: AuditContext,
	costItemId: string,
	input: CostItemInput
): Promise<{ ok: true } | { ok: false; reason: CostItemError }> {
	const { accountId } = context;
	const existing = await getCostItem(db, accountId, costItemId);
	if (!existing) return { ok: false, reason: 'missing' };
	const checked = await checkReferences(db, accountId, input);
	if ('reason' in checked) return { ok: false, reason: checked.reason };
	const moved = input.propertyId !== existing.propertyId;
	const amountsStay = checked.keyKind === 'direct' && !moved;
	await runBatch(db, [
		db
			.update(costItems)
			.set(moved ? { ...input, insurancePolicyId: null } : input)
			.where(and(eq(costItems.accountId, accountId), eq(costItems.id, costItemId))),
		...(amountsStay
			? []
			: [db.delete(costItemUnitAmounts).where(eq(costItemUnitAmounts.costItemId, costItemId))]),
		...(moved
			? [
					db
						.update(documents)
						.set({ propertyId: input.propertyId })
						.where(and(eq(documents.accountId, accountId), eq(documents.costItemId, costItemId)))
				]
			: []),
		auditEntry(db, context, 'cost_item', costItemId, 'update', `Beleg ${itemLabel(input)} geändert`)
	]);
	return { ok: true };
}

/** Deletes the item after its receipt documents; the per-unit amounts cascade. */
export async function deleteCostItem(
	db: Database,
	context: AuditContext,
	costItemId: string,
	options?: { storage?: Storage }
): Promise<'deleted' | 'missing'> {
	const { accountId } = context;
	const existing = await getCostItem(db, accountId, costItemId);
	if (!existing) return 'missing';
	for (const receipt of existing.receipts) await deleteDocument(db, context, receipt.id, options);
	await runBatch(db, [
		db
			.delete(costItems)
			.where(and(eq(costItems.accountId, accountId), eq(costItems.id, costItemId))),
		auditEntry(
			db,
			context,
			'cost_item',
			costItemId,
			'delete',
			`Beleg ${itemLabel(existing)} gelöscht`
		)
	]);
	return 'deleted';
}

/** The per-unit amounts of a direct-key item, in the order of the units. */
export async function listUnitAmounts(
	db: Database,
	accountId: string,
	costItemId: string
): Promise<UnitAmount[]> {
	return db
		.select({ unitId: costItemUnitAmounts.unitId, amount: costItemUnitAmounts.amount })
		.from(costItemUnitAmounts)
		.innerJoin(units, eq(units.id, costItemUnitAmounts.unitId))
		.where(
			and(
				eq(costItemUnitAmounts.accountId, accountId),
				eq(costItemUnitAmounts.costItemId, costItemId)
			)
		)
		.orderBy(asc(units.name));
}

/**
 * Replaces the per-unit amounts of an item in one batch. Every unit must be one of the item's
 * property; a unit with 0 gets no row.
 */
export async function replaceUnitAmounts(
	db: Database,
	context: AuditContext,
	costItemId: string,
	amounts: UnitAmount[]
): Promise<'updated' | 'missing' | 'unknown-unit'> {
	const { accountId } = context;
	const item = await getCostItem(db, accountId, costItemId);
	if (!item) return 'missing';
	const rows = amounts.filter((entry) => entry.amount !== 0);
	const unitIds = [...new Set(rows.map((entry) => entry.unitId))];
	if (unitIds.length !== rows.length) return 'unknown-unit';
	let own = 0;
	for (const ids of chunkIds(unitIds)) {
		const rows = await db
			.select({ id: units.id })
			.from(units)
			.where(
				and(
					eq(units.accountId, accountId),
					eq(units.propertyId, item.propertyId),
					inArray(units.id, ids)
				)
			);
		own += rows.length;
	}
	if (own !== unitIds.length) return 'unknown-unit';
	await runBatch(db, [
		db.delete(costItemUnitAmounts).where(eq(costItemUnitAmounts.costItemId, costItemId)),
		...chunk(rows, rowsPerStatement(costItemUnitAmounts)).map((group) =>
			db
				.insert(costItemUnitAmounts)
				.values(group.map((entry) => ({ accountId, costItemId, ...entry })))
		),
		auditEntry(
			db,
			context,
			'cost_item',
			costItemId,
			'update',
			`Beträge je Einheit des Belegs ${itemLabel(item)} geändert`
		)
	]);
	return 'updated';
}
