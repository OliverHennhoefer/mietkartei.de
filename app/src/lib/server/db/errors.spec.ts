import { describe, expect, it } from 'vitest';
import { costCategories, leases } from './schema';
import { isConflictError } from './errors';
import { testDatabase } from '../testing';

const failureOf = (promise: Promise<unknown>) =>
	promise.then(
		() => undefined,
		(error: unknown) => error
	);

describe('isConflictError', () => {
	it('recognizes a foreign key or unique violation the driver reports, also when wrapped', async () => {
		const db = await testDatabase();
		const foreignKey = await failureOf(
			db
				.insert(leases)
				.values({ accountId: 'a', unitId: 'nope', startDate: '2026-01-01', baseRent: 1 })
		);
		const category = { accountId: 'a', name: 'Grundsteuer', allocable: true };
		await db.insert(costCategories).values(category);
		const unique = await failureOf(db.insert(costCategories).values(category));

		expect(isConflictError(foreignKey)).toBe(true);
		expect(isConflictError(unique)).toBe(true);
		expect(isConflictError(new Error('outer', { cause: foreignKey }))).toBe(true);
		expect(isConflictError(new Error('NOT NULL constraint failed'))).toBe(false);
		expect(isConflictError('FOREIGN KEY constraint failed')).toBe(false);
	});
});
