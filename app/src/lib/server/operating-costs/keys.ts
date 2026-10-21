import { and, asc, eq, getTableColumns, inArray, ne } from 'drizzle-orm';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from '../db/batch';
import {
	allocationKeyShares,
	allocationKeys,
	properties,
	units,
	type AllocationKeyKind,
	type MeterKind
} from '../db/schema';
import { assertQuota } from '../quotas';

// Umlageschlüssel: how a cost is split over the units. The shares of a custom key are kept in
// allocation_key_shares, one row per unit of the key's property; every other kind computes its
// weights in the statement.

export type AllocationKey = typeof allocationKeys.$inferSelect;

export type AllocationKeyInput = {
	name: string;
	kind: AllocationKeyKind;
	/** Null: usable for every property. A custom key always names its property. */
	propertyId: string | null;
	meterKind: MeterKind | null;
	consumptionPercent: number | null;
};

export type AllocationKeyWithProperty = AllocationKey & { propertyName: string | null };

export type KeyShare = { unitId: string; share: number };

export type KeyError = 'missing' | 'duplicate-name' | 'unknown-property';

function query(db: Database, accountId: string, keyId?: string) {
	const conditions = [eq(allocationKeys.accountId, accountId)];
	if (keyId !== undefined) conditions.push(eq(allocationKeys.id, keyId));
	return db
		.select({ ...getTableColumns(allocationKeys), propertyName: properties.name })
		.from(allocationKeys)
		.leftJoin(properties, eq(properties.id, allocationKeys.propertyId))
		.where(and(...conditions))
		.orderBy(asc(allocationKeys.createdAt), asc(allocationKeys.name));
}

/** The keys of the account, oldest first (the seeded ones come first), with their property. */
export async function listKeys(
	db: Database,
	accountId: string
): Promise<AllocationKeyWithProperty[]> {
	return query(db, accountId);
}

export async function getKey(
	db: Database,
	accountId: string,
	keyId: string
): Promise<AllocationKeyWithProperty | undefined> {
	const [row] = await query(db, accountId, keyId);
	return row;
}

/** The name must be free in the account and the property, when given, must be the account's. */
async function checkInput(
	db: Database,
	accountId: string,
	input: AllocationKeyInput,
	exceptId?: string
): Promise<KeyError | undefined> {
	const conditions = [eq(allocationKeys.accountId, accountId), eq(allocationKeys.name, input.name)];
	if (exceptId) conditions.push(ne(allocationKeys.id, exceptId));
	const [taken] = await db
		.select({ id: allocationKeys.id })
		.from(allocationKeys)
		.where(and(...conditions));
	if (taken) return 'duplicate-name';
	if (input.propertyId) {
		const [property] = await db
			.select({ id: properties.id })
			.from(properties)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, input.propertyId)));
		if (!property) return 'unknown-property';
	}
	return undefined;
}

/** Only consumption and mixed keys carry a meter kind, only mixed ones a percentage. */
function keyColumns(input: AllocationKeyInput) {
	const byMeter = input.kind === 'consumption' || input.kind === 'mixed';
	return {
		name: input.name,
		kind: input.kind,
		propertyId: input.propertyId,
		meterKind: byMeter ? input.meterKind : null,
		consumptionPercent: input.kind === 'mixed' ? input.consumptionPercent : null
	};
}

export async function createKey(
	db: Database,
	context: AuditContext,
	input: AllocationKeyInput
): Promise<{ ok: true; id: string } | { ok: false; reason: KeyError }> {
	const { accountId } = context;
	await assertQuota(db, accountId, 'allocationKeys');
	const reason = await checkInput(db, accountId, input);
	if (reason) return { ok: false, reason };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(allocationKeys).values({ id, accountId, ...keyColumns(input) }),
		auditEntry(
			db,
			context,
			'allocation_key',
			id,
			'create',
			`Umlageschlüssel ${input.name} angelegt`
		)
	]);
	return { ok: true, id };
}

/**
 * Updates the key. Shares only make sense for a custom key of one property, so they go when the
 * kind or the property changes.
 */
export async function updateKey(
	db: Database,
	context: AuditContext,
	keyId: string,
	input: AllocationKeyInput
): Promise<{ ok: true } | { ok: false; reason: KeyError }> {
	const { accountId } = context;
	const existing = await getKey(db, accountId, keyId);
	if (!existing) return { ok: false, reason: 'missing' };
	const reason = await checkInput(db, accountId, input, keyId);
	if (reason) return { ok: false, reason };
	const sharesStay = input.kind === 'custom' && input.propertyId === existing.propertyId;
	await runBatch(db, [
		db
			.update(allocationKeys)
			.set(keyColumns(input))
			.where(and(eq(allocationKeys.accountId, accountId), eq(allocationKeys.id, keyId))),
		...(sharesStay
			? []
			: [db.delete(allocationKeyShares).where(eq(allocationKeyShares.keyId, keyId))]),
		auditEntry(
			db,
			context,
			'allocation_key',
			keyId,
			'update',
			`Umlageschlüssel ${input.name} geändert`
		)
	]);
	return { ok: true };
}

export async function deleteKey(
	db: Database,
	context: AuditContext,
	keyId: string
): Promise<'deleted' | 'missing'> {
	const { accountId } = context;
	const existing = await getKey(db, accountId, keyId);
	if (!existing) return 'missing';
	await runBatch(db, [
		db
			.delete(allocationKeys)
			.where(and(eq(allocationKeys.accountId, accountId), eq(allocationKeys.id, keyId))),
		auditEntry(
			db,
			context,
			'allocation_key',
			keyId,
			'delete',
			`Umlageschlüssel ${existing.name} gelöscht`
		)
	]);
	return 'deleted';
}

/** The shares of a custom key by unit, in the order of the units. */
export async function listKeyShares(
	db: Database,
	accountId: string,
	keyId: string
): Promise<KeyShare[]> {
	return db
		.select({ unitId: allocationKeyShares.unitId, share: allocationKeyShares.share })
		.from(allocationKeyShares)
		.innerJoin(units, eq(units.id, allocationKeyShares.unitId))
		.where(and(eq(allocationKeyShares.accountId, accountId), eq(allocationKeyShares.keyId, keyId)))
		.orderBy(asc(units.name));
}

/**
 * Replaces the shares of a custom key in one batch. Every unit must belong to the key's
 * property; a share of 0 is kept out, so a unit without a share has no row.
 */
export async function replaceKeyShares(
	db: Database,
	context: AuditContext,
	keyId: string,
	shares: KeyShare[]
): Promise<'updated' | 'missing' | 'not-custom' | 'unknown-unit'> {
	const { accountId } = context;
	const key = await getKey(db, accountId, keyId);
	if (!key) return 'missing';
	if (key.kind !== 'custom' || !key.propertyId) return 'not-custom';
	const rows = shares.filter((share) => share.share > 0);
	const unitIds = [...new Set(rows.map((share) => share.unitId))];
	if (unitIds.length !== rows.length) return 'unknown-unit';
	let own = 0;
	for (const ids of chunkIds(unitIds)) {
		const rows = await db
			.select({ id: units.id })
			.from(units)
			.where(
				and(
					eq(units.accountId, accountId),
					eq(units.propertyId, key.propertyId),
					inArray(units.id, ids)
				)
			);
		own += rows.length;
	}
	if (own !== unitIds.length) return 'unknown-unit';
	await runBatch(db, [
		db.delete(allocationKeyShares).where(eq(allocationKeyShares.keyId, keyId)),
		...chunk(rows, rowsPerStatement(allocationKeyShares)).map((group) =>
			db
				.insert(allocationKeyShares)
				.values(
					group.map((share) => ({ accountId, keyId, unitId: share.unitId, share: share.share }))
				)
		),
		auditEntry(
			db,
			context,
			'allocation_key',
			keyId,
			'update',
			`Anteile des Umlageschlüssels ${key.name} geändert`
		)
	]);
	return 'updated';
}
