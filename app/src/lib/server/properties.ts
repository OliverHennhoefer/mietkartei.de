import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './db';
import { properties, units } from './db/schema';
import type { PropertyInput, UnitInput } from '../validation';

// All queries take the account explicitly, so data of one account can never leak into another.

export async function listProperties(db: Database, accountId: string) {
	return db
		.select()
		.from(properties)
		.where(eq(properties.accountId, accountId))
		.orderBy(asc(properties.name), asc(properties.createdAt));
}

export async function getProperty(db: Database, accountId: string, propertyId: string) {
	const [property] = await db
		.select()
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	return property;
}

export async function createProperty(db: Database, accountId: string, input: PropertyInput) {
	const [property] = await db
		.insert(properties)
		.values({ ...input, accountId })
		.returning();
	return property;
}

export async function listUnits(db: Database, accountId: string, propertyId: string) {
	return db
		.select()
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, propertyId)))
		.orderBy(asc(units.name), asc(units.createdAt));
}

/** Returns undefined when the property does not exist in this account. */
export async function createUnit(
	db: Database,
	accountId: string,
	propertyId: string,
	input: UnitInput
) {
	const property = await getProperty(db, accountId, propertyId);
	if (!property) return undefined;
	const [unit] = await db
		.insert(units)
		.values({ ...input, accountId, propertyId })
		.returning();
	return unit;
}
