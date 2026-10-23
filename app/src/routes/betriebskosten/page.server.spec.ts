import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import {
	outcome,
	routeEvent,
	seedCostItem,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;
let propertyId: string;

beforeEach(async () => {
	db = await testDatabase();
	const seeded = await seedUnit(db, 'a');
	propertyId = seeded.propertyId;
	await seedLease(db, 'a', seeded.unitId);
	await seedCostItem(db, 'a', propertyId);
});

function create(form: Record<string, string>) {
	return outcome(() => actions.create(routeEvent(db, { form })));
}

describe('betriebskosten', () => {
	it('suggests last calendar year for a new statement', async () => {
		const lastYear = new Date().getFullYear() - 1;
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: {
				groups: [],
				properties: [{ id: propertyId }],
				defaults: { periodStart: `${lastYear}-01-01`, periodEnd: `${lastYear}-12-31` }
			}
		});
	});

	it('creates a draft and opens it', async () => {
		const result = await create({ propertyId, periodStart: '2025-01-01', periodEnd: '2025-12-31' });
		expect(result).toEqual({
			redirect: expect.stringMatching(/^\/betriebskosten\/abrechnungen\/.+/)
		});
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: { groups: [expect.anything()] }
		});
	});

	it('refuses a malformed period and a property of another account on the property field', async () => {
		expect(
			await create({ propertyId, periodStart: '2025-12-31', periodEnd: '2025-01-01' })
		).toMatchObject({ fail: 400, data: { errors: { periodEnd: expect.any(String) } } });
		const other = await seedUnit(db, 'b');
		expect(
			await create({
				propertyId: other.propertyId,
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31'
			})
		).toMatchObject({ fail: 400, data: { errors: { propertyId: expect.any(String) } } });
	});
});
