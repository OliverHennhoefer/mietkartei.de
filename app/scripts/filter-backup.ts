// Filters an export of the hosted database for its weekly copy in R2: drops the rows that
// keepBackupLine leaves out and reports how many. Used by .github/workflows/backup.yml as
//   node scripts/filter-backup.ts <export.sql> <copy.sql>
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { keepBackupLine } from '../src/lib/server/backup.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
	console.error('Usage: node scripts/filter-backup.ts <export.sql> <copy.sql>');
	process.exit(2);
}

const out = createWriteStream(output);
let kept = 0;
let dropped = 0;
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
	if (keepBackupLine(line)) {
		kept++;
		if (!out.write(`${line}\n`)) await once(out, 'drain');
	} else {
		dropped++;
	}
}
out.end();
await once(out, 'finish');
console.log(`Kept ${kept} lines, left out ${dropped} rows of Mietinteressenten.`);
