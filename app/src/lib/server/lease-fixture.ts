// The plain lease the tests start from: unit tests through testing.ts and the e2e seed route,
// which cannot import testing.ts because it loads the SQLite driver.

import type { LeaseInput } from './leases';

/** A plain residential lease from 2025-01-01 at 600 € + 150 € + 50 €. */
export function leaseInput(unitId: string, overrides: Partial<LeaseInput> = {}): LeaseInput {
	return {
		unitId,
		extraUnitIds: [],
		tenantIds: [],
		startDate: '2025-01-01',
		endDate: null,
		kind: 'residential',
		rentModel: 'fixed',
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		baseRent: 60000,
		parkingRent: 0,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		securityDeposit: 180000,
		persons: 2,
		rentDueDay: 3,
		ledgerStart: null,
		indexBaseMonth: null,
		indexBaseValue: null,
		indexBaseYear: '2020',
		terminatedAt: null,
		terminatedBy: null,
		notes: null,
		...overrides
	};
}
