import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getProperty } from '#lib/server/properties.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { load } from './+page.server';

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
});

async function run() {
	const property = await getProperty(db, 'a', propertyId);
	return outcome(() => load(routeEvent(db, { params: { id: propertyId }, parent: { property } })));
}

describe('objekte/[id]/lage', () => {
	it('sets the Kaltmiete per square metre of the running leases beside the Gemeinde', async () => {
		await seedLease(db, 'a', unitId);
		expect(await run()).toMatchObject({
			data: { rentLevel: { perSquareMetre: 9_38, area: 64, count: 1 }, indexLeases: [] }
		});
	});

	it('lists the Indexmieten with what holds an increase back', async () => {
		const leaseId = await seedLease(db, 'a', unitId, { rentModel: 'indexed' });
		expect(await run()).toMatchObject({
			data: {
				indexLeases: [
					{
						id: leaseId,
						unitName: 'EG links',
						proposal: undefined,
						refusal: 'Dem Mietvertrag fehlt der Bezugsindex (Basismonat und Indexwert).'
					}
				]
			}
		});
	});

	it('has no rent level without a running lease', async () => {
		await seedLease(db, 'a', unitId, { startDate: '2020-01-01', endDate: '2020-12-31' });
		expect(await run()).toMatchObject({ data: { rentLevel: null, indexLeases: [] } });
	});
});
