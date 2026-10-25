import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { auditLog, costCategories } from './db/schema';
import {
	createPolicy,
	deletePolicy,
	getPolicy,
	insurancePrefill,
	linkCostItemToPolicy,
	listPolicies,
	updatePolicy,
	type InsurancePolicyInput
} from './insurance';
import { ensureDefaults } from './operating-costs';
import { contextA, contextB, seedCostItem, seedUnit, testDatabase } from './testing';

let db: Database;
let propertyId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId } = await seedUnit(db, 'a'));
});

const input = (overrides: Partial<InsurancePolicyInput> = {}): InsurancePolicyInput => ({
	kind: 'building',
	insurer: 'Allianz',
	policyNumber: 'WG-123',
	annualPremium: 1200_00,
	renewalDate: '2024-01-01',
	noticeMonths: 3,
	endDate: null,
	note: null,
	...overrides
});

describe('insurance policies', () => {
	it('creates, updates and deletes a policy with an audit line each', async () => {
		const created = await createPolicy(db, contextA, propertyId, input());
		if (!created.ok) throw new Error('create');
		expect(await getPolicy(db, 'a', created.id)).toMatchObject({ propertyId, insurer: 'Allianz' });
		expect(await updatePolicy(db, contextA, created.id, input({ insurer: 'HUK' }))).toBe(true);
		expect((await getPolicy(db, 'a', created.id))?.insurer).toBe('HUK');
		expect(await deletePolicy(db, contextA, created.id)).toBe(true);
		expect(await getPolicy(db, 'a', created.id)).toBeUndefined();

		const rows = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(
			rows.map((row) => row.summary).filter((summary) => summary.includes('versicherung'))
		).toEqual([
			'Wohngebäudeversicherung (Allianz) angelegt',
			'Wohngebäudeversicherung (HUK) geändert',
			'Wohngebäudeversicherung (HUK) gelöscht'
		]);
	});

	it("keeps to the account: another account's property or policy is refused", async () => {
		const other = await seedUnit(db, 'b');
		expect(await createPolicy(db, contextA, other.propertyId, input())).toEqual({ ok: false });
		const foreign = await createPolicy(db, contextB, other.propertyId, input());
		if (!foreign.ok) throw new Error('create');
		expect(await getPolicy(db, 'a', foreign.id)).toBeUndefined();
		expect(await updatePolicy(db, contextA, foreign.id, input())).toBe(false);
		expect(await deletePolicy(db, contextA, foreign.id)).toBe(false);
		expect(await listPolicies(db, 'a', other.propertyId)).toEqual([]);
	});

	it('lists the insurance years of last and this year with the Beleg taken over for each', async () => {
		const building = await createPolicy(db, contextA, propertyId, input());
		const liability = await createPolicy(db, contextA, propertyId, input({ kind: 'liability' }));
		if (!building.ok || !liability.ok) throw new Error('create');
		const period = { supplier: 'Allianz', periodStart: '2025-01-01', periodEnd: '2025-12-31' };
		const itemId = await seedCostItem(db, 'a', propertyId, period);
		// Same insurer and period, but entered by hand: no proof for either policy.
		await seedCostItem(db, 'a', propertyId, period);
		await linkCostItemToPolicy(db, 'a', itemId, building.id);
		// Another account's policy or a Beleg of another property is not linked.
		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		const elsewhere = await seedCostItem(db, 'a', other.propertyId, period);
		await linkCostItemToPolicy(db, 'a', elsewhere, liability.id);
		await linkCostItemToPolicy(db, 'b', itemId, liability.id);

		const [first, second] = await listPolicies(db, 'a', propertyId, '2026-10-23');
		expect(first.years).toEqual([
			{ start: '2025-01-01', end: '2025-12-31', amount: 1200_00, costItemId: itemId },
			{ start: '2026-01-01', end: '2026-12-31', amount: 1200_00, costItemId: null }
		]);
		expect(second.years.map((year) => year.costItemId)).toEqual([null, null]);
	});

	it('prefills the Beleg of an insurance year with the § 13 category', async () => {
		await ensureDefaults(db, 'a');
		const [category] = await db
			.select({ id: costCategories.id })
			.from(costCategories)
			.where(eq(costCategories.betrkvItem, 13));
		const building = await createPolicy(db, contextA, propertyId, input({ endDate: '2026-06-30' }));
		const rentLoss = await createPolicy(db, contextA, propertyId, input({ kind: 'rent_loss' }));
		if (!building.ok || !rentLoss.ok) throw new Error('create');

		expect(await insurancePrefill(db, 'a', building.id, '2026-01-01')).toEqual({
			insurancePolicyId: building.id,
			propertyId,
			categoryId: category.id,
			description: 'Wohngebäudeversicherung 01.01.2026 bis 30.06.2026',
			supplier: 'Allianz',
			periodStart: '2026-01-01',
			periodEnd: '2026-06-30',
			amount: 595_07,
			allocable: true
		});
		expect(await insurancePrefill(db, 'a', rentLoss.id, '2026-01-01')).toMatchObject({
			categoryId: undefined,
			allocable: false
		});
		expect(await insurancePrefill(db, 'a', building.id, '2026-02-01')).toBeUndefined();
		expect(await insurancePrefill(db, 'b', building.id, '2026-01-01')).toBeUndefined();
	});
});
