import { and, asc, eq } from 'drizzle-orm';
import { today } from '../dates';
import { rentOn, type RentChange } from '../domain/rents';
import type { Database } from './db';
import { rentChanges } from './db/schema';

// The rent history of a lease. Creating and editing a lease writes its initial row (leases.ts);
// the changes after it come from rent-adjustments.ts.

export type RentChangeRow = typeof rentChanges.$inferSelect;

export async function listRentChanges(db: Database, accountId: string, leaseId: string) {
	return db
		.select()
		.from(rentChanges)
		.where(and(eq(rentChanges.accountId, accountId), eq(rentChanges.leaseId, leaseId)))
		.orderBy(asc(rentChanges.validFrom), asc(rentChanges.createdAt));
}

/** The rent valid on the day, or undefined before the first change. */
export async function rentOnDate(
	db: Database,
	accountId: string,
	leaseId: string,
	date = today()
): Promise<RentChange | undefined> {
	return rentOn(await listRentChanges(db, accountId, leaseId), date);
}
