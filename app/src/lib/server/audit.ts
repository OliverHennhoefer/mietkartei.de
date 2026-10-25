import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './db';
import { auditLog, users, type AuditAction } from './db/schema';

/** Entries written in the same millisecond keep the order they were inserted in. */
const insertOrder = sql`"audit_log"."rowid"`;

// Every change a landlord would want to look up later gets one line: who, when, what.
// The summary is a German sentence, e.g. "Objekt Lindenstraße 4 angelegt".

export type AuditContext = { accountId: string; userId: string | null };

/** Builds the insert statement, to run in the same runBatch as the change it records. */
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

/**
 * The newest entries of the account's log, optionally narrowed to one entity (the filter on
 * /einstellungen/protokoll).
 */
export async function listAuditLog(
	db: Database,
	accountId: string,
	{ entity, limit = 200 }: { entity?: string; limit?: number } = {}
) {
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
		.where(and(eq(auditLog.accountId, accountId), entity ? eq(auditLog.entity, entity) : undefined))
		.orderBy(desc(auditLog.at), desc(insertOrder))
		.limit(limit);
}

/** The distinct entities the account's log holds, for the filter. */
export async function listAuditEntities(db: Database, accountId: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ entity: auditLog.entity })
		.from(auditLog)
		.where(eq(auditLog.accountId, accountId))
		.orderBy(asc(auditLog.entity));
	return rows.map((row) => row.entity);
}
