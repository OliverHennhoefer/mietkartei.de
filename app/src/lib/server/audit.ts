import { desc, eq } from 'drizzle-orm';
import type { Database } from './db';
import { auditLog, users, type AuditAction } from './db/schema';

// Every change a landlord would want to look up later gets one line: who, when, what.
// The summary is a German sentence, e.g. "Mietvertrag Wohnung EG links angelegt".

export type AuditContext = { accountId: string; userId: string | null };

export async function logChange(
	db: Database,
	context: AuditContext,
	entity: string,
	entityId: string,
	action: AuditAction,
	summary: string
): Promise<void> {
	await db.insert(auditLog).values({
		accountId: context.accountId,
		userId: context.userId,
		entity,
		entityId,
		action,
		summary
	});
}

/** Builds the insert statement for use inside runBatch. */
export function auditEntry(
	db: Database,
	context: AuditContext,
	entity: string,
	entityId: string,
	action: AuditAction,
	summary: string
) {
	return db.insert(auditLog).values({
		accountId: context.accountId,
		userId: context.userId,
		entity,
		entityId,
		action,
		summary
	});
}

export async function listAuditLog(db: Database, accountId: string, limit = 200) {
	return db
		.select({
			id: auditLog.id,
			at: auditLog.at,
			entity: auditLog.entity,
			entityId: auditLog.entityId,
			action: auditLog.action,
			summary: auditLog.summary,
			userEmail: users.email,
			userName: users.name
		})
		.from(auditLog)
		.leftJoin(users, eq(auditLog.userId, users.id))
		.where(eq(auditLog.accountId, accountId))
		.orderBy(desc(auditLog.at))
		.limit(limit);
}
