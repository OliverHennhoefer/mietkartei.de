import { desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog, co2CostSplits, properties, rentCharges } from './db/schema';
import type { Database } from './db';
import { co2Deadline, createCo2Split, deleteCo2Split, listCo2Splits } from './co2';
import type { Co2SplitInput } from './co2';
import { createLease } from './leases';
import { contextA, contextB, leaseInput, seedUnit, testDatabase } from './testing';

let db: Database;
let propertyId: string;
let leaseId: string;
let foreignLeaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	// Account a: a 64 m² apartment in a residential building; account b: the same, foreign.
	const own = await seedUnit(db, 'a');
	const foreign = await seedUnit(db, 'b');
	propertyId = own.propertyId;
	const lease = await createLease(db, contextA, leaseInput(own.unitId));
	const foreignLease = await createLease(db, contextB, leaseInput(foreign.unitId));
	if (!lease.ok || !foreignLease.ok) throw new Error('setup failed');
	leaseId = lease.id;
	foreignLeaseId = foreignLease.id;
});

// The reference scenario: 25.000 kWh gas, 5.025 kg CO₂, 300 € CO₂ cost, measured against the
// 72,5 m² of the EG dwelling: 5.025 / 72,5 = 69,31 kg/m² → tier ≥ 52 kg → landlord 95 % → 285 €.
const reference: Co2SplitInput = {
	year: 2025,
	fuel: 'gas',
	fuelKwh: 25000,
	co2Kg: 5025,
	co2Cost: 30000,
	area: 72.5,
	invoiceDate: '2026-02-10',
	claimedOn: '2026-03-15'
};

async function chargesOf(lease: string) {
	return db
		.select()
		.from(rentCharges)
		.where(eq(rentCharges.leaseId, lease))
		.orderBy(desc(rentCharges.createdAt));
}

describe('co2Deadline', () => {
	it('is twelve months after the claim', () => {
		expect(co2Deadline('2026-03-15')).toBe('2027-03-15');
		expect(co2Deadline('2024-02-29')).toBe('2025-02-28');
	});
});

describe('createCo2Split', () => {
	it('stores the split and posts the landlord share as a credit, with an audit entry', async () => {
		const result = await createCo2Split(db, contextA, leaseId, reference);
		expect(result).toEqual({
			ok: true,
			id: expect.any(String),
			chargeId: expect.any(String),
			landlordPercent: 95,
			amount: 28500
		});
		if (!result.ok) return;

		const [row] = await db.select().from(co2CostSplits).where(eq(co2CostSplits.id, result.id));
		expect(row).toMatchObject({
			accountId: 'a',
			leaseId,
			year: 2025,
			fuel: 'gas',
			fuelKwh: 25000,
			co2Kg: 5025,
			co2Cost: 30000,
			area: 72.5,
			landlordPercent: 95,
			amount: 28500,
			invoiceDate: '2026-02-10',
			claimedOn: '2026-03-15',
			chargeId: result.chargeId,
			createdBy: 'user-a'
		});

		const charges = await chargesOf(leaseId);
		expect(charges).toHaveLength(1);
		expect(charges[0]).toMatchObject({
			id: result.chargeId,
			accountId: 'a',
			kind: 'co2_reimbursement',
			amount: -28500,
			period: '2026-03',
			dueDate: '2027-03-15',
			referenceId: result.id,
			note: 'CO2-Kostenaufteilung 2025'
		});

		const [entry] = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.entityId, leaseId))
			.orderBy(desc(auditLog.at))
			.limit(1);
		expect(entry).toMatchObject({ accountId: 'a', userId: 'user-a', action: 'post' });
		expect(entry.summary).toBe(
			'CO₂-Kostenaufteilung 2025: Vermieteranteil 95 % (285,00\u00a0€) als Gutschrift gebucht'
		);
	});

	it('uses the residential tiers: 1.000 kg on 64 m² is 15,6 kg/m² and 10 %', async () => {
		// 1.000 / 64 = 15,625 kg/m² → tier 12–<17 → 10 % of 200 € = 20 €
		const result = await createCo2Split(db, contextA, leaseId, {
			...reference,
			co2Kg: 1000,
			co2Cost: 20000,
			area: 64
		});
		expect(result).toMatchObject({ ok: true, landlordPercent: 10, amount: 2000 });
		// Below 12 kg/m² the landlord bears nothing, but the split is still recorded.
		const nothing = await createCo2Split(db, contextA, leaseId, {
			...reference,
			year: 2024,
			co2Kg: 700,
			co2Cost: 20000,
			area: 64
		});
		expect(nothing).toMatchObject({ ok: true, landlordPercent: 0, amount: 0 });
	});

	it('splits half and half in a non-residential building', async () => {
		await db
			.update(properties)
			.set({ buildingUse: 'non_residential' })
			.where(eq(properties.id, propertyId));
		// 50 % of 300 € = 150 €, whatever the emissions per m².
		const result = await createCo2Split(db, contextA, leaseId, { ...reference, co2Kg: 100 });
		expect(result).toMatchObject({ ok: true, landlordPercent: 50, amount: 15000 });
	});

	it('refuses a second split for the same year', async () => {
		expect((await createCo2Split(db, contextA, leaseId, reference)).ok).toBe(true);
		expect(await createCo2Split(db, contextA, leaseId, { ...reference, co2Kg: 100 })).toEqual({
			ok: false,
			reason: 'duplicate'
		});
		expect(await chargesOf(leaseId)).toHaveLength(1);
		// Another year is fine.
		expect((await createCo2Split(db, contextA, leaseId, { ...reference, year: 2024 })).ok).toBe(
			true
		);
	});

	it('does not leak into another account', async () => {
		expect(await createCo2Split(db, contextA, foreignLeaseId, reference)).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await createCo2Split(db, contextA, 'no-such-lease', reference)).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await chargesOf(foreignLeaseId)).toHaveLength(0);
		expect(await listCo2Splits(db, 'b', foreignLeaseId)).toEqual([]);
	});
});

describe('listCo2Splits', () => {
	it('lists the splits of the lease, newest year first, with kg/m² and deadline', async () => {
		await createCo2Split(db, contextA, leaseId, {
			...reference,
			year: 2024,
			claimedOn: '2025-04-01'
		});
		await createCo2Split(db, contextA, leaseId, reference);
		const splits = await listCo2Splits(db, 'a', leaseId);
		expect(splits.map((split) => split.year)).toEqual([2025, 2024]);
		expect(splits[0].kgPerSquareMetre).toBeCloseTo(69.31, 2);
		expect(splits[0].deadline).toBe('2027-03-15');
		expect(splits[0].deadlinePassed).toBe(false);
		// Claimed on 2025-04-01, due by 2026-04-01: passed on any day after that.
		expect(splits[1].deadline).toBe('2026-04-01');
		expect(splits[1].deadlinePassed).toBe(true);
	});

	it('does not leak into another account', async () => {
		await createCo2Split(db, contextB, foreignLeaseId, reference);
		expect(await listCo2Splits(db, 'a', foreignLeaseId)).toEqual([]);
		expect(await listCo2Splits(db, 'b', foreignLeaseId)).toHaveLength(1);
	});
});

describe('deleteCo2Split', () => {
	it('removes the split and its credit together, with an audit entry', async () => {
		const created = await createCo2Split(db, contextA, leaseId, reference);
		if (!created.ok) throw new Error('setup failed');
		expect(await deleteCo2Split(db, contextA, created.id)).toBe('deleted');
		expect(await db.select().from(co2CostSplits).where(eq(co2CostSplits.leaseId, leaseId))).toEqual(
			[]
		);
		expect(await chargesOf(leaseId)).toEqual([]);
		const [entry] = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.entityId, leaseId))
			.orderBy(desc(auditLog.at))
			.limit(1);
		expect(entry).toMatchObject({ action: 'delete' });
		expect(entry.summary).toBe(
			'CO₂-Kostenaufteilung 2025 mit Gutschrift über 285,00\u00a0€ gelöscht'
		);
		// The year can be entered again afterwards.
		expect((await createCo2Split(db, contextA, leaseId, reference)).ok).toBe(true);
	});

	it('does not leak into another account', async () => {
		const foreign = await createCo2Split(db, contextB, foreignLeaseId, reference);
		if (!foreign.ok) throw new Error('setup failed');
		expect(await deleteCo2Split(db, contextA, foreign.id)).toBe('missing');
		expect(await deleteCo2Split(db, contextA, 'no-such-split')).toBe('missing');
		expect(await listCo2Splits(db, 'b', foreignLeaseId)).toHaveLength(1);
		expect(await chargesOf(foreignLeaseId)).toHaveLength(1);
	});
});
