/**
 * Whether the error, or one it wraps, means the change lost a race against another request: a
 * foreign key violation (a reference to something deleted meanwhile) or a unique violation
 * (something with the same name or period created meanwhile). The server functions check both
 * first, so this is the database's last line when two tabs or two people of the account save at
 * once; better-sqlite3 and D1 both say "FOREIGN KEY constraint failed" or "UNIQUE constraint failed".
 */
export function isConflictError(error: unknown): boolean {
	for (let current = error, depth = 0; current && depth < 5; depth++) {
		if (
			current instanceof Error &&
			/(FOREIGN KEY|UNIQUE) constraint failed/.test(current.message)
		) {
			return true;
		}
		current = current instanceof Error ? current.cause : undefined;
	}
	return false;
}
