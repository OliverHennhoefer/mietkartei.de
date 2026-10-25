/**
 * Whether the error, or one it wraps, is a foreign key violation: a change that would leave a
 * reference to nothing. The server functions check references first, so this is the database's
 * last line when two requests race; better-sqlite3 and D1 both say "FOREIGN KEY constraint failed".
 */
export function isForeignKeyError(error: unknown): boolean {
	for (let current = error, depth = 0; current && depth < 5; depth++) {
		if (current instanceof Error && current.message.includes('FOREIGN KEY constraint failed')) {
			return true;
		}
		current = current instanceof Error ? current.cause : undefined;
	}
	return false;
}
