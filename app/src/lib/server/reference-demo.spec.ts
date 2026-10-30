import { beforeEach, describe, expect, it } from 'vitest';
import { referenceCases } from '../domain/reference-cases';
import { computeStatement } from '../domain/statement';
import type { Database } from './db';
import { createReferenceData, referenceCase } from './reference-demo';
import { getStatement, loadStatementInput } from './statements';
import { contextA, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('referenceCase', () => {
	it('finds a case by its slug only', () => {
		expect(referenceCase('mieterwechsel')?.title).toBe('Mieterwechsel mitten im Monat');
		expect(referenceCase('unbekannt')).toBeUndefined();
		expect(referenceCase(null)).toBeUndefined();
	});
});

describe('createReferenceData', () => {
	for (const c of referenceCases) {
		it(`${c.slug}: the draft in the demo gives every tenant the share of the page`, async () => {
			const id = await createReferenceData(db, contextA, c);
			const statement = await getStatement(db, 'a', id!);
			expect(statement?.statement.status).toBe('draft');
			const input = await loadStatementInput(db, 'a', statement!.statement.propertyId, {
				start: `${c.year}-01-01`,
				end: `${c.year}-12-31`
			});
			const result = computeStatement(input!);
			expect(result.property.warnings).toEqual([]);
			expect(result.property.landlordCo2Share).toBe(c.expected.landlordCo2Share);
			expect(result.property.vacancyShare).toBe(c.expected.vacancyShare);
			// The rows have ids of their own: leases are told apart by tenant, items by description.
			const leaseOf = new Map(input!.leases.map((lease) => [lease.id, lease.tenants[0].lastName]));
			const itemOf = new Map(input!.items.map((item) => [item.id, item.description]));
			const actual = Object.fromEntries(
				result.leases.map((lease) => [
					leaseOf.get(lease.leaseId),
					{
						shares: Object.fromEntries(
							lease.lines.map((line) => [itemOf.get(line.itemId), line.amount])
						),
						prepayments: lease.prepaymentsTotal
					}
				])
			);
			const expected = Object.fromEntries(
				c.leases.map((lease) => [
					lease.tenant.lastName,
					{
						shares: Object.fromEntries(
							c.items.map((item) => [item.description, c.expected.leases[lease.id].shares[item.id]])
						),
						prepayments: c.expected.leases[lease.id].prepayments
					}
				])
			);
			expect(actual).toEqual(expected);
		});
	}

	it('leaves an account with data alone', async () => {
		await seedUnit(db, 'a');
		expect(await createReferenceData(db, contextA, referenceCases[0])).toBeNull();
	});
});
