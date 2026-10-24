import { describe, expect, it } from 'vitest';
import { leases } from './schema';
import { isForeignKeyError } from './errors';
import { testDatabase } from '../testing';

describe('isForeignKeyError', () => {
	it('recognizes a violation the driver reports, also when wrapped', async () => {
		const db = await testDatabase();
		const failure = await db
			.insert(leases)
			.values({ accountId: 'a', unitId: 'nope', startDate: '2026-01-01', baseRent: 1 })
			.then(
				() => undefined,
				(error: unknown) => error
			);
		expect(isForeignKeyError(failure)).toBe(true);
		expect(isForeignKeyError(new Error('outer', { cause: failure }))).toBe(true);
		expect(isForeignKeyError(new Error('UNIQUE constraint failed'))).toBe(false);
		expect(isForeignKeyError('FOREIGN KEY constraint failed')).toBe(false);
	});
});
