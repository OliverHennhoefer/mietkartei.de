// What the weekly copy of the hosted database leaves out (see .github/workflows/backup.yml).
// Mietinteressenten have a deletion deadline of their own (the DSK allows at most six months after
// the Absage), so their lettings, their answers and the log lines that name them stay out of the
// copies, which R2 keeps for 12 weeks. D1 Time Travel still covers them for 30 days.
//
// `wrangler d1 export` writes one statement per line: newlines inside a value come out as
// replace('…\n…','\n',char(10)), so dropping a line drops exactly one row. Kept is everything
// else, including the schema, so a restored copy has the tables and its migrations stay in step.

/** The tables whose rows stay out of the weekly copy; their schema stays in. */
export const excludedTables = ['applicants', 'lettings'] as const;

/** The audit entities whose log lines stay out of the weekly copy. */
export const excludedAuditEntities = ['applicant'] as const;

const insert = /^INSERT INTO "([^"]+)" \(([^)]*)\) VALUES\(/;

/**
 * The leading literals of a VALUES list, as far as they are plain strings, numbers or NULL;
 * parsing stops at anything else (such as replace(…)). Strings come back unquoted.
 */
function leadingValues(values: string, count: number): (string | null)[] {
	const result: (string | null)[] = [];
	let index = 0;
	while (result.length < count && index < values.length) {
		if (values[index] === "'") {
			let text = '';
			index++;
			for (;;) {
				const end = values.indexOf("'", index);
				if (end === -1) return result;
				text += values.slice(index, end);
				if (values[end + 1] === "'") {
					text += "'";
					index = end + 2;
				} else {
					index = end + 1;
					break;
				}
			}
			result.push(text);
		} else {
			const match = /^(NULL|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(values.slice(index));
			if (!match) return result;
			result.push(match[1].toUpperCase() === 'NULL' ? null : match[1]);
			index += match[1].length;
		}
		if (values[index] !== ',') return result;
		index++;
	}
	return result;
}

/** Whether a line of the export goes into the weekly copy. */
export function keepBackupLine(line: string): boolean {
	const match = insert.exec(line);
	if (!match) return true;
	const [prefix, table, columnList] = match;
	if ((excludedTables as readonly string[]).includes(table)) return false;
	if (table !== 'audit_log') return true;
	const columns = columnList.split(',').map((column) => column.trim().replace(/^"|"$/g, ''));
	const position = columns.indexOf('entity');
	if (position === -1) return true;
	const entity = leadingValues(line.slice(prefix.length), position + 1)[position];
	return !(excludedAuditEntities as readonly string[]).includes(entity ?? '');
}
