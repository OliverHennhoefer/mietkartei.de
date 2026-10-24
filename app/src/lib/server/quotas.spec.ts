import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { assertQuota, QUOTAS, usage } from './quotas';
import { addProperty } from './properties';
import { address, contextA, contextB, testDatabase } from './testing';

const property = {
	...address,
	name: 'Haus',
	buildingUse: 'residential' as const,
	state: null,
	vacancyPersons: 1,
	notes: null
};

describe('quotas', () => {
	it('counts only the rows of the account', async () => {
		const db = await testDatabase();
		await addProperty(db, contextA, property);
		await addProperty(db, contextB, property);
		await addProperty(db, contextB, property);
		expect(await usage(db, 'a', 'properties')).toBe(1);
		expect(await usage(db, 'b', 'properties')).toBe(2);
	});

	it('refuses with 409 when the addition would exceed the limit', async () => {
		const db = await testDatabase();
		await addProperty(db, contextA, property);
		const max = QUOTAS.properties.max;
		await expect(assertQuota(db, 'a', 'properties', max - 1)).resolves.toBeUndefined();
		const refusal = await assertQuota(db, 'a', 'properties', max).catch((error) => error);
		expect(isHttpError(refusal, 409)).toBe(true);
		expect(refusal.body.message).toContain('höchstens 500 Objekte');
	});
});
