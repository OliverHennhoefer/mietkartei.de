import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db';
import { chunk, rowsPerStatement, runBatch } from '../db/batch';
import { accounts, allocationKeys, costCategories } from '../db/schema';
import {
	type DefaultCategory,
	defaultCategories,
	defaultKeyNameFor,
	defaultKeys,
	defaultLandlordCategories
} from '../../domain/operating-cost-defaults';

// The categories and keys every account starts with (domain/operating-cost-defaults.ts). Seeded once,
// on first use of any operating costs page, and marked on the account; `onConflictDoNothing` on
// the unique (account, name) indexes keeps two racing first requests harmless.

/**
 * Seeds the standard categories and keys of the account, each allocable category with the key
 * the BetrKV suggests, unless that happened before. Once seeded, the landlord owns the list:
 * renamed, deleted or keyless entries stay as they are. One select when seeded; otherwise one
 * more select for keys the landlord already gave a default name, and one batch. Every page of the
 * feature calls this first; returns whether this call seeded.
 */
export async function ensureDefaults(db: Database, accountId: string): Promise<boolean> {
	const [account] = await db
		.select({ seeded: accounts.operatingCostDefaultsSeeded })
		.from(accounts)
		.where(eq(accounts.id, accountId));
	if (!account || account.seeded) return false;

	// A key the landlord created before the first seeding keeps its name, so the insert below
	// skips the default of that name; the categories must then point at the key that exists.
	const existing = await db
		.select({ id: allocationKeys.id, name: allocationKeys.name })
		.from(allocationKeys)
		.where(
			and(
				eq(allocationKeys.accountId, accountId),
				inArray(
					allocationKeys.name,
					defaultKeys.map((key) => key.name)
				)
			)
		);
	const keyIdByName = new Map(existing.map((key) => [key.name, key.id]));
	const keys = defaultKeys
		.filter((key) => !keyIdByName.has(key.name))
		.map((key) => ({ id: crypto.randomUUID(), accountId, propertyId: null, ...key }));
	for (const key of keys) keyIdByName.set(key.name, key.id);
	const keyIdFor = (category: DefaultCategory) => {
		const keyName = defaultKeyNameFor(category.name);
		return keyName === null ? null : (keyIdByName.get(keyName) ?? null);
	};
	const categories = [...defaultCategories, ...defaultLandlordCategories].map((category) => ({
		id: crypto.randomUUID(),
		accountId,
		...category,
		allocationKeyId: keyIdFor(category)
	}));

	await runBatch(db, [
		...chunk(keys, rowsPerStatement(allocationKeys)).map((rows) =>
			db.insert(allocationKeys).values(rows).onConflictDoNothing()
		),
		...chunk(categories, rowsPerStatement(costCategories)).map((rows) =>
			db.insert(costCategories).values(rows).onConflictDoNothing()
		),
		db.update(accounts).set({ operatingCostDefaultsSeeded: true }).where(eq(accounts.id, accountId))
	]);
	return true;
}
