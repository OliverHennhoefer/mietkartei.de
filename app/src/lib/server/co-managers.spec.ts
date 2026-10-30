import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PropertyInput, UnitInput } from '../validation';
import type { Database } from './db';
import { auditLog, costCategories, leases, properties, rentCharges, users } from './db/schema';
import { isConflictError } from './db/errors';
import { ensureCharges } from './ledger';
import { createLease } from './leases';
import { createCategory, type CostCategoryInput } from './operating-costs';
import { addProperty, addUnit, getUnit, listUnits, updateUnit } from './properties';
import { createTenant, getTenant, updateTenant } from './tenants';
import {
	address,
	contextA,
	integrityProblems,
	leaseInput,
	seedLease,
	seedUnit,
	tenantInput,
	testDatabase
} from './testing';

// The owner and a co-manager (Mitverwalter) of one account working at the same time. Every
// request runs its reads and its batch separately, so Promise.all interleaves them the way two
// browsers on the same D1 database do: one request's checks can run between the other's.

const manager = { accountId: 'a', userId: 'manager-a' };

function propertyInput(name: string): PropertyInput {
	return {
		name,
		...address,
		kind: 'building',
		associationManager: null,
		ownershipShare: null,
		ownershipShareTotal: null,
		buildingUse: 'residential',
		state: null,
		vacancyPersons: 1,
		notes: null
	};
}

function unitInput(name: string, floorArea = 64): UnitInput {
	return { name, kind: 'apartment', floorArea, floor: null, rooms: null, notes: null };
}

function categoryInput(name: string): CostCategoryInput {
	return {
		name,
		betrkvItem: null,
		allocable: true,
		consumptionBased: false,
		allocationKeyId: null,
		billingCircleId: null,
		sortOrder: 100
	};
}

/** What one person enters in a session: a property with two units, two tenants and two leases. */
async function enterPortfolio(db: Database, context: typeof contextA, label: string) {
	const property = await addProperty(db, context, propertyInput(`Haus ${label}`));
	const unitIds: string[] = [];
	for (const name of ['EG', 'OG']) {
		const unit = await addUnit(db, context, property.id, unitInput(`${name} ${label}`));
		unitIds.push(unit!.id);
	}
	for (const [index, unitId] of unitIds.entries()) {
		const tenant = await createTenant(db, context, tenantInput({ lastName: `${label} ${index}` }));
		const lease = await createLease(db, context, leaseInput(unitId, { tenantIds: [tenant.id] }));
		expect(lease.ok).toBe(true);
	}
}

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await db.insert(users).values({
		id: 'manager-a',
		accountId: 'a',
		email: 'manager@example.org',
		passwordHash: 'x',
		role: 'manager'
	});
});

describe('owner and co-manager at the same time', () => {
	it('keeps everything both enter in parallel, each change attributed to its author', async () => {
		await Promise.all([
			enterPortfolio(db, contextA, 'Owner'),
			enterPortfolio(db, manager, 'Manager'),
			enterPortfolio(db, contextA, 'Owner 2'),
			enterPortfolio(db, manager, 'Manager 2')
		]);

		expect(await db.$count(properties, eq(properties.accountId, 'a'))).toBe(4);
		const accountLeases = await db.select().from(leases).where(eq(leases.accountId, 'a'));
		expect(accountLeases).toHaveLength(8);
		for (const lease of accountLeases) {
			const months = await db
				.select({ period: rentCharges.period })
				.from(rentCharges)
				.where(and(eq(rentCharges.leaseId, lease.id), eq(rentCharges.kind, 'rent')));
			expect(new Set(months.map((row) => row.period)).size).toBe(months.length);
			expect(months.length).toBeGreaterThan(0);
		}
		const byUser = await db
			.select({ userId: auditLog.userId, summary: auditLog.summary })
			.from(auditLog)
			.where(eq(auditLog.accountId, 'a'));
		expect(byUser.filter((row) => row.userId === 'manager-a')).toHaveLength(14);
		expect(byUser.filter((row) => row.userId === 'user-a')).toHaveLength(14);
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('creates each monthly rent charge once when both open the rent ledger at once', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const leaseId = await seedLease(db, 'a', unitId);

		await Promise.all([
			ensureCharges(db, 'a', [leaseId], '2026-06'),
			ensureCharges(db, 'a', [leaseId], '2026-06'),
			ensureCharges(db, 'a', [leaseId], '2026-06')
		]);

		const charges = await db
			.select({ period: rentCharges.period })
			.from(rentCharges)
			.where(and(eq(rentCharges.leaseId, leaseId), eq(rentCharges.kind, 'rent')));
		expect(charges).toHaveLength(18);
	});

	it('keeps both edits when they change different units of the same property', async () => {
		const property = await addProperty(db, contextA, propertyInput('Haus'));
		const eg = await addUnit(db, contextA, property.id, unitInput('EG'));
		const og = await addUnit(db, contextA, property.id, unitInput('OG'));

		await Promise.all([
			updateUnit(db, contextA, eg!.id, unitInput('EG', 70)),
			updateUnit(db, manager, og!.id, unitInput('OG', 80)),
			addUnit(db, manager, property.id, unitInput('DG'))
		]);

		expect((await getUnit(db, 'a', eg!.id))?.floorArea).toBe(70);
		expect((await getUnit(db, 'a', og!.id))?.floorArea).toBe(80);
		expect((await listUnits(db, 'a', property.id)).map((unit) => unit.name).sort()).toEqual([
			'DG',
			'EG',
			'OG'
		]);
	});

	it('lets the later save win when both edit the same tenant', async () => {
		const tenant = await createTenant(db, contextA, tenantInput());

		await updateTenant(db, contextA, tenant.id, tenantInput({ phone: '030 111' }));
		await updateTenant(db, manager, tenant.id, tenantInput({ email: 'erika@example.org' }));

		// No locking: the second form was loaded before the first save and overwrites it whole.
		expect(await getTenant(db, 'a', tenant.id)).toMatchObject({
			phone: null,
			email: 'erika@example.org'
		});
	});

	it('refuses the second of two same-named categories as a conflict, not a crash', async () => {
		const results = await Promise.allSettled([
			createCategory(db, contextA, categoryInput('Gartenpflege Hof')),
			createCategory(db, manager, categoryInput('Gartenpflege Hof'))
		]);

		// Both checks for the name run before either insert; the unique index stops the second one,
		// and the hook answers it with 409 and a message to reload.
		const [first, second] = results;
		expect(first.status === 'fulfilled' && first.value.ok).toBe(true);
		expect(second.status === 'rejected' && isConflictError(second.reason)).toBe(true);
		const rows = await db
			.select()
			.from(costCategories)
			.where(and(eq(costCategories.accountId, 'a'), eq(costCategories.name, 'Gartenpflege Hof')));
		expect(rows).toHaveLength(1);
	});
});
