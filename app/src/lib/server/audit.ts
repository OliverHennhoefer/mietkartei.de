import type { Database } from './db';
import { auditLog, type AuditAction } from './db/schema';

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
