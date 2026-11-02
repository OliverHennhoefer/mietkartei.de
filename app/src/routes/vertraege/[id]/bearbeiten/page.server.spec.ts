import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { manualChange } from '#lib/server/rent-adjustments.ts';
import {
	contextA,
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions } from './+page.server';

let db: Database;
let leaseId: string;
let tenantId: string;

// A residential lease from 2025-01-01 at 600 € with 50 € for the garage, and a Kaltmiete of
// 400 € from 2026-01-01 that inherited the 50 €.
beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	tenantId = await seedTenant(db, 'a');
	leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId], parkingRent: 5000 });
	await manualChange(db, contextA, leaseId, {
		validFrom: '2026-01-01',
		baseRent: 40000,
		parkingRent: 5000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		reason: 'manual',
		note: null
	});
});

const form = (parkingRent: string) => ({
	tenantIds: tenantId,
	startDate: '2025-01-01',
	kind: 'residential',
	rentModel: 'fixed',
	operatingCostModel: 'prepayment',
	heatingCostModel: 'prepayment',
	baseRent: '600,00',
	parkingRent,
	operatingCostPrepayment: '150,00',
	heatingCostPrepayment: '50,00'
});

function update(values: Record<string, string>) {
	return outcome(() => actions.update(routeEvent(db, { params: { id: leaseId }, form: values })));
}

describe('editing the parking share of a lease', () => {
	it('refuses a share that the later Kaltmiete of 400 € would not hold', async () => {
		expect(await update(form('450,00'))).toMatchObject({
			fail: 400,
			data: {
				errors: { parkingRent: expect.stringContaining('Ab dem 01.01.2026 läge der Anteil') }
			}
		});
		expect(await update(form('60,00'))).toEqual({ redirect: `/vertraege/${leaseId}` });
	});
});
