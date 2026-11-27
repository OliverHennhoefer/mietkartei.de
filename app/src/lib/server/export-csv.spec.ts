import { count, eq, sum } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeCsv, parseCsv } from '../csv';
import type { Database } from './db';
import { leases, payments, properties, tenants, units } from './db/schema';
import { createDemoData } from './demo';
import { readableCsv, readableTables } from './export-csv';
import { commitImport, loadImportContext, planImport, proposeMapping } from './import';
import { contextA, memoryStorage, testDatabase } from './testing';

let source: Database;
let target: Database;

beforeEach(async () => {
	source = await testDatabase();
	target = await testDatabase();
	const created = await createDemoData(source, contextA, { storage: memoryStorage() });
	if (!created.ok) throw new Error(created.reason);
});

async function totals(db: Database) {
	const counted = async (
		table: typeof properties | typeof units | typeof tenants | typeof leases
	) => (await db.select({ n: count() }).from(table).where(eq(table.accountId, 'a')))[0].n;
	const [paid] = await db
		.select({ n: count(), total: sum(payments.amount) })
		.from(payments)
		.where(eq(payments.accountId, 'a'));
	return {
		properties: await counted(properties),
		units: await counted(units),
		tenants: await counted(tenants),
		leases: await counted(leases),
		payments: paid.n,
		paid: Number(paid.total)
	};
}

describe('readable tables', () => {
	it('writes CSV files with the import columns that import into an empty account again', async () => {
		for (const table of readableTables) {
			const text = await readableCsv(source, 'a', table);
			expect(text.startsWith('﻿')).toBe(true);
			const rows = parseCsv(decodeCsv(new TextEncoder().encode(text)));
			const proposal = proposeMapping(table.kind, rows);
			// Every column maps onto its field, in order.
			expect(Object.values(proposal.mapping)).toEqual(rows[0].map((_, index) => index));
			const context = await loadImportContext(target, 'a', table.kind);
			const plan = planImport(table.kind, rows, proposal.headerIndex, proposal.mapping, context);
			const skipped = plan.rows.filter((row) => row.reason !== undefined);
			expect(skipped, table.file).toEqual([]);
			await commitImport(target, contextA, plan);
		}
		const before = await totals(source);
		expect(before.leases).toBeGreaterThan(0);
		expect(await totals(target)).toEqual(before);
	});
});
