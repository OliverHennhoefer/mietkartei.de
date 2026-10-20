import { and, asc, eq } from 'drizzle-orm';
import { today } from '../dates';
import { rentOn, type RentChange } from '../domain/rents';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { rentChanges, type RentChangeReason } from './db/schema';
import { getLease } from './leases';

// The rent history of a lease. Reading is shared by the ledger and the statement; the rent
// feature adds graduated and indexed changes on top of addRentChange.

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

export type RentChangeInput = {
	validFrom: string;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	reason: RentChangeReason;
	note: string | null;
};

/** Adds an approved change to the history. Returns undefined when the lease is not in the account. */
export async function addRentChange(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: RentChangeInput
): Promise<string | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(rentChanges).values({
			id,
			accountId: context.accountId,
			leaseId,
			...input,
			status: 'approved',
			createdBy: context.userId
		}),
		auditEntry(db, context, 'lease', leaseId, 'update', `Miete ab ${input.validFrom} geändert`)
	]);
	return id;
}

export async function deleteRentChange(
	db: Database,
	context: AuditContext,
	changeId: string
): Promise<boolean> {
	const [change] = await db
		.select()
		.from(rentChanges)
		.where(and(eq(rentChanges.accountId, context.accountId), eq(rentChanges.id, changeId)));
	// The initial change belongs to the lease itself and is edited there.
	if (!change || change.reason === 'initial') return false;
	await runBatch(db, [
		db.delete(rentChanges).where(eq(rentChanges.id, changeId)),
		auditEntry(
			db,
			context,
			'lease',
			change.leaseId,
			'update',
			`Mietänderung ab ${change.validFrom} entfernt`
		)
	]);
	return true;
}
