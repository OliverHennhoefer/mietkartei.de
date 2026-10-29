import { and, count, eq } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { contractors, tasks } from './db/schema';
import { assertQuota } from './quotas';

// Handwerker: the firms and people the landlord hires. A task (usually a Reparatur) names the one
// who does the job; deleting a Handwerker keeps the tasks and only clears the name there.

export type ContractorInput = {
	name: string;
	trade: string | null;
	phone: string | null;
	email: string | null;
	note: string | null;
};

export type Contractor = typeof contractors.$inferSelect;

/** By name, each with the number of tasks that name them. */
export async function listContractors(
	db: Database,
	accountId: string
): Promise<(Contractor & { taskCount: number })[]> {
	const [rows, counts] = await Promise.all([
		db.select().from(contractors).where(eq(contractors.accountId, accountId)),
		db
			.select({ contractorId: tasks.contractorId, value: count() })
			.from(tasks)
			.where(eq(tasks.accountId, accountId))
			.groupBy(tasks.contractorId)
	]);
	const byId = new Map(counts.map((row) => [row.contractorId, row.value]));
	return rows
		.map((row) => ({ ...row, taskCount: byId.get(row.id) ?? 0 }))
		.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function getContractor(
	db: Database,
	accountId: string,
	contractorId: string
): Promise<Contractor | undefined> {
	const [row] = await db
		.select()
		.from(contractors)
		.where(and(eq(contractors.accountId, accountId), eq(contractors.id, contractorId)));
	return row;
}

export async function createContractor(
	db: Database,
	context: AuditContext,
	input: ContractorInput
): Promise<string> {
	const { accountId } = context;
	await assertQuota(db, accountId, 'contractors');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(contractors).values({ id, accountId, ...input }),
		auditEntry(db, context, 'contractor', id, 'create', `Handwerker „${input.name}“ angelegt`)
	]);
	return id;
}

/** False when the Handwerker is not in the account. */
export async function updateContractor(
	db: Database,
	context: AuditContext,
	contractorId: string,
	input: ContractorInput
): Promise<boolean> {
	const { accountId } = context;
	if (!(await getContractor(db, accountId, contractorId))) return false;
	await runBatch(db, [
		db
			.update(contractors)
			.set(input)
			.where(and(eq(contractors.accountId, accountId), eq(contractors.id, contractorId))),
		auditEntry(
			db,
			context,
			'contractor',
			contractorId,
			'update',
			`Handwerker „${input.name}“ geändert`
		)
	]);
	return true;
}

/** Deletes the Handwerker and clears the name on the tasks. False when not in the account. */
export async function deleteContractor(
	db: Database,
	context: AuditContext,
	contractorId: string
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getContractor(db, accountId, contractorId);
	if (!existing) return false;
	await runBatch(db, [
		db
			.update(tasks)
			.set({ contractorId: null })
			.where(and(eq(tasks.accountId, accountId), eq(tasks.contractorId, contractorId))),
		db
			.delete(contractors)
			.where(and(eq(contractors.accountId, accountId), eq(contractors.id, contractorId))),
		auditEntry(
			db,
			context,
			'contractor',
			contractorId,
			'delete',
			`Handwerker „${existing.name}“ gelöscht`
		)
	]);
	return true;
}
