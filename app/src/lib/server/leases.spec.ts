import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import {
	auditLog,
	depositTransactions,
	leasePersons,
	leaseTenants,
	leaseUnits,
	rentChanges
} from './db/schema';
import {
	addLeasePersons,
	createLease,
	deleteLease,
	deleteLeasePersons,
	endLease,
	getLease,
	isActive,
	leaseInputOf,
	leaseLabel,
	listLeasePersons,
	listLeases,
	listUnitsWithProperty,
	updateLease
} from './leases';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('isActive', () => {
	it('is active from the start date to the end date, inclusive', () => {
		const lease = { startDate: '2025-01-01', endDate: '2025-12-31' };
		expect(isActive(lease, '2024-12-31')).toBe(false);
		expect(isActive(lease, '2025-01-01')).toBe(true);
		expect(isActive(lease, '2025-12-31')).toBe(true);
		expect(isActive(lease, '2026-01-01')).toBe(false);
		expect(isActive({ startDate: '2025-01-01', endDate: null }, '2099-01-01')).toBe(true);
	});
});

describe('createLease', () => {
	it('creates the lease with tenants, extra units, the initial rent and an audit line', async () => {
		const { unitId, propertyId } = await seedUnit(db, 'a', { name: 'EG links' });
		const { unitId: parkingId } = await seedUnit(db, 'a', { name: 'Stellplatz 3' });
		const tenantId = await seedTenant(db, 'a');

		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, { tenantIds: [tenantId, tenantId], extraUnitIds: [parkingId, unitId] })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const lease = await getLease(db, 'a', result.id);
		expect(lease).toMatchObject({
			unit: { id: unitId, name: 'EG links' },
			property: { id: propertyId },
			baseRent: 60000,
			currentRent: { baseRent: 60000, operatingCostPrepayment: 15000, heatingCostPrepayment: 5000 },
			active: true
		});
		expect(leaseLabel(lease!)).toBe('EG links · Haus');
		expect(lease!.tenants.map((tenant) => tenant.id)).toEqual([tenantId]);
		// The main unit is never also an extra unit, and duplicates are dropped.
		expect(lease!.extraUnits.map((unit) => unit.id)).toEqual([parkingId]);

		const history = await db.select().from(rentChanges).where(eq(rentChanges.leaseId, result.id));
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({
			accountId: 'a',
			validFrom: '2025-01-01',
			reason: 'initial',
			status: 'approved',
			createdBy: 'user-a'
		});
		const persons = await db.select().from(leasePersons).where(eq(leasePersons.leaseId, result.id));
		expect(persons).toHaveLength(1);
		expect(persons[0]).toMatchObject({ accountId: 'a', validFrom: '2025-01-01', persons: 2 });
		const extra = await db.select().from(leaseUnits);
		expect(extra).toEqual([{ accountId: 'a', leaseId: result.id, unitId: parkingId }]);

		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit.map((entry) => [entry.entity, entry.entityId, entry.action])).toEqual([
			['lease', result.id, 'create']
		]);
	});

	it('refuses units and tenants of another account', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const foreignTenant = await seedTenant(db, 'b');

		expect(await createLease(db, contextA, leaseInput(foreignUnit))).toEqual({
			ok: false,
			reason: 'unknown-unit'
		});
		expect(
			await createLease(db, contextA, leaseInput(unitId, { extraUnitIds: [foreignUnit] }))
		).toEqual({ ok: false, reason: 'unknown-unit' });
		expect(
			await createLease(db, contextA, leaseInput(unitId, { tenantIds: [foreignTenant] }))
		).toEqual({ ok: false, reason: 'unknown-tenant' });
		expect(await listLeases(db, 'a')).toEqual([]);
		expect(await db.select().from(auditLog)).toEqual([]);
	});
});

describe('listLeases and getLease', () => {
	it('lists only the leases of the account, newest start first', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		await createLease(
			db,
			contextA,
			leaseInput(unitId, { startDate: '2020-01-01', endDate: '2022-12-31' })
		);
		await createLease(db, contextA, leaseInput(unitId, { startDate: '2023-01-01' }));
		await createLease(db, contextB, leaseInput(foreignUnit));

		const starts = (await listLeases(db, 'a')).map((lease) => [lease.startDate, lease.active]);
		expect(starts).toEqual([
			['2023-01-01', true],
			['2020-01-01', false]
		]);
	});

	it('filters by unit (including extra units) and tenant', async () => {
		const { unitId: flat } = await seedUnit(db, 'a', { name: 'Wohnung' });
		const { unitId: parking } = await seedUnit(db, 'a', {
			name: 'Stellplatz',
			propertyName: 'Garage'
		});
		const tenantId = await seedTenant(db, 'a');
		const withParking = await createLease(
			db,
			contextA,
			leaseInput(flat, { extraUnitIds: [parking], tenantIds: [tenantId] })
		);
		const parkingOnly = await createLease(db, contextA, leaseInput(parking));
		if (!withParking.ok || !parkingOnly.ok) throw new Error('setup failed');

		const ids = (leases: { id: string }[]) => leases.map((lease) => lease.id).sort();
		expect(ids(await listLeases(db, 'a', { unitId: parking }))).toEqual(
			[withParking.id, parkingOnly.id].sort()
		);
		expect(ids(await listLeases(db, 'a', { unitId: flat }))).toEqual([withParking.id]);
		expect(ids(await listLeases(db, 'a', { tenantId }))).toEqual([withParking.id]);
	});

	it('does not return a lease of another account', async () => {
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const result = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!result.ok) throw new Error('setup failed');
		expect(await getLease(db, 'a', result.id)).toBeUndefined();
		expect(await getLease(db, 'b', result.id)).toBeDefined();
	});

	it('reports the rent valid today as the current rent', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId, { startDate: '2020-01-01' }));
		if (!result.ok) throw new Error('setup failed');
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2021-01-01',
			baseRent: 65000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			status: 'approved'
		});
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2099-01-01',
			baseRent: 99000,
			reason: 'manual',
			status: 'approved'
		});
		expect((await getLease(db, 'a', result.id))!.currentRent.baseRent).toBe(65000);
	});
});

describe('updateLease', () => {
	it('replaces tenants and extra units and moves the initial rent with the start date', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: parking } = await seedUnit(db, 'a', { name: 'Stellplatz' });
		const first = await seedTenant(db, 'a', { firstName: 'Eins' });
		const second = await seedTenant(db, 'a', { firstName: 'Zwei' });
		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, { tenantIds: [first], extraUnitIds: [parking] })
		);
		if (!result.ok) throw new Error('setup failed');
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2026-01-01',
			baseRent: 65000,
			reason: 'manual'
		});

		const updated = await updateLease(
			db,
			contextA,
			result.id,
			leaseInput(unitId, {
				tenantIds: [second],
				extraUnitIds: [],
				startDate: '2025-02-01',
				baseRent: 61000,
				persons: 3
			})
		);
		expect(updated).toEqual({ ok: true });

		const lease = await getLease(db, 'a', result.id);
		expect(lease).toMatchObject({ startDate: '2025-02-01', baseRent: 61000, persons: 3 });
		expect(lease!.tenants.map((tenant) => tenant.firstName)).toEqual(['Zwei']);
		expect(lease!.extraUnits).toEqual([]);
		const persons = await db.select().from(leasePersons).where(eq(leasePersons.leaseId, result.id));
		expect(persons.map((row) => [row.validFrom, row.persons])).toEqual([['2025-02-01', 3]]);

		const history = await db
			.select({ validFrom: rentChanges.validFrom, baseRent: rentChanges.baseRent })
			.from(rentChanges)
			.where(eq(rentChanges.leaseId, result.id))
			.orderBy(rentChanges.validFrom);
		expect(history).toEqual([
			{ validFrom: '2025-02-01', baseRent: 61000 },
			{ validFrom: '2026-01-01', baseRent: 65000 }
		]);
	});

	it('refuses to update a lease of another account or with foreign references', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const own = await createLease(db, contextA, leaseInput(unitId));
		const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!own.ok || !foreign.ok) throw new Error('setup failed');

		expect(await updateLease(db, contextA, foreign.id, leaseInput(unitId))).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await updateLease(db, contextA, own.id, leaseInput(foreignUnit))).toEqual({
			ok: false,
			reason: 'unknown-unit'
		});
		expect((await getLease(db, 'a', own.id))!.unitId).toBe(unitId);
	});

	it('corrects the initial amounts, deposit and persons, and later rows that inherited them', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!result.ok) throw new Error('setup failed');
		// A § 560 row copied the Kaltmiete of 600 €; a manual row set its own Kaltmiete of 700 €.
		await db.insert(rentChanges).values([
			{
				accountId: 'a',
				leaseId: result.id,
				validFrom: '2025-06-01',
				baseRent: 60000,
				operatingCostPrepayment: 17000,
				heatingCostPrepayment: 5000,
				reason: 'statement'
			},
			{
				accountId: 'a',
				leaseId: result.id,
				validFrom: '2026-01-01',
				baseRent: 70000,
				operatingCostPrepayment: 17000,
				heatingCostPrepayment: 5000,
				reason: 'manual'
			}
		]);
		// The Kaltmiete was typed as 600 € instead of 610 €, the heating prepayment as 50 € instead
		// of 55 €, the deposit and the persons wrong too.
		expect(
			await updateLease(
				db,
				contextA,
				result.id,
				leaseInput(unitId, {
					tenantIds: [tenantId],
					baseRent: 61000,
					heatingCostPrepayment: 5500,
					securityDeposit: 183000,
					persons: 3
				})
			)
		).toEqual({ ok: true });
		const history = await db
			.select()
			.from(rentChanges)
			.where(eq(rentChanges.leaseId, result.id))
			.orderBy(rentChanges.validFrom);
		// The § 560 row takes 610 € (it carried the old 600 €); the manual row keeps its 700 €. Both
		// carried the heating prepayment of 50 € and take 55 €.
		expect(
			history.map((row) => [row.validFrom, row.reason, row.baseRent, row.heatingCostPrepayment])
		).toEqual([
			['2025-01-01', 'initial', 61000, 5500],
			['2025-06-01', 'statement', 61000, 5500],
			['2026-01-01', 'manual', 70000, 5500]
		]);
		const lease = await getLease(db, 'a', result.id);
		expect(lease).toMatchObject({ securityDeposit: 183000, persons: 3 });
		const persons = await db.select().from(leasePersons).where(eq(leasePersons.leaseId, result.id));
		expect(persons.map((row) => [row.validFrom, row.persons])).toEqual([['2025-01-01', 3]]);
		const [entry] = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, 'update'))
			.orderBy(auditLog.at);
		expect(entry.summary).toBe(
			'Mietvertrag geändert: Kaltmiete bei Vertragsbeginn 610,00\u00a0€, Heizkostenvorauszahlung 55,00\u00a0€, Kaution 1.830,00\u00a0€, Personen bei Einzug 3 (gilt auch für 2 spätere Mietänderungen)'
		);
	});

	it('refuses a start date on or after a later rent change or persons row instead of failing', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const tenantId = await seedTenant(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!result.ok) throw new Error('setup failed');
		await db.insert(rentChanges).values({
			accountId: 'a',
			leaseId: result.id,
			validFrom: '2026-01-01',
			baseRent: 65000,
			reason: 'graduated'
		});
		await db
			.insert(leasePersons)
			.values({ accountId: 'a', leaseId: result.id, validFrom: '2025-09-01', persons: 3 });
		const move = (startDate: string) =>
			updateLease(
				db,
				contextA,
				result.id,
				leaseInput(unitId, { tenantIds: [tenantId], startDate })
			);

		// On the day of the persons row (the unique index would have failed the batch) and after
		// the rent change: refused, naming the earliest blocking date.
		expect(await move('2025-09-01')).toEqual({
			ok: false,
			reason: 'start-after-changes',
			date: '2025-09-01'
		});
		expect(await move('2026-01-01')).toEqual({
			ok: false,
			reason: 'start-after-changes',
			date: '2025-09-01'
		});
		expect((await getLease(db, 'a', result.id))!.startDate).toBe('2025-01-01');
		// Before both rows: fine.
		expect(await move('2025-03-01')).toEqual({ ok: true });
	});
});

describe('listLeases with many leases', () => {
	it('binds at most 100 parameters per statement (D1) and keeps tenants and units in order', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const zed = await seedTenant(db, 'a', { firstName: 'Zoe', lastName: 'Zander' });
		const abe = await seedTenant(db, 'a', { firstName: 'Abe', lastName: 'Adler' });
		for (let index = 0; index < 120; index += 1) {
			const lease = await createLease(
				db,
				contextA,
				leaseInput(unitId, { tenantIds: [zed, abe], startDate: '2025-01-01' })
			);
			if (!lease.ok) throw new Error('setup failed');
		}
		// SQLite allows thousands of variables; D1 refuses more than 100. Count them here.
		const client = (db as unknown as { $client: { prepare: (sql: string) => unknown } }).$client;
		const prepare = client.prepare.bind(client);
		let most = 0;
		client.prepare = (sql: string) => {
			most = Math.max(most, (sql.match(/\?/g) ?? []).length);
			return prepare(sql);
		};
		try {
			const leases = await listLeases(db, 'a');
			expect(leases).toHaveLength(120);
			expect(leases.every((lease) => lease.currentRent.baseRent === 60000)).toBe(true);
			expect(leases[119].tenants.map((tenant) => tenant.lastName)).toEqual(['Adler', 'Zander']);
		} finally {
			client.prepare = prepare;
		}
		expect(most).toBeGreaterThan(0);
		expect(most).toBeLessThanOrEqual(100);
	});
});

describe('deleteLease', () => {
	it('deletes the lease with its links and rent history, and logs it', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: parking } = await seedUnit(db, 'a', { name: 'Stellplatz' });
		const tenantId = await seedTenant(db, 'a');
		const result = await createLease(
			db,
			contextA,
			leaseInput(unitId, { tenantIds: [tenantId], extraUnitIds: [parking] })
		);
		if (!result.ok) throw new Error('setup failed');

		expect(await deleteLease(db, contextA, result.id)).toBe('deleted');
		expect(await getLease(db, 'a', result.id)).toBeUndefined();
		expect(await db.select().from(leaseTenants)).toEqual([]);
		expect(await db.select().from(leaseUnits)).toEqual([]);
		expect(await db.select().from(leasePersons)).toEqual([]);
		expect(await db.select().from(rentChanges)).toEqual([]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(audit[0]?.summary).toBe('Mietvertrag EG links · Haus gelöscht');
	});

	it('does not delete a lease of another account', async () => {
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!foreign.ok) throw new Error('setup failed');
		expect(await deleteLease(db, contextA, foreign.id)).toBe('missing');
		expect(await getLease(db, 'b', foreign.id)).toBeDefined();
	});

	it('refuses to delete a lease with deposit movements on it', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId));
		if (!result.ok) throw new Error('setup failed');
		await db.insert(depositTransactions).values({
			accountId: 'a',
			leaseId: result.id,
			date: '2025-01-03',
			amount: 60000,
			kind: 'received'
		});
		expect(await deleteLease(db, contextA, result.id)).toBe('in-use');
		expect(await getLease(db, 'a', result.id)).toBeDefined();
	});
});

describe('listUnitsWithProperty', () => {
	it('lists the units of the account with their property, sorted by property then unit', async () => {
		await seedUnit(db, 'a', { name: 'OG', propertyName: 'Haus B' });
		await seedUnit(db, 'a', { name: 'EG', propertyName: 'Haus A' });
		await seedUnit(db, 'b', { name: 'Fremd', propertyName: 'Haus 0' });
		const rows = await listUnitsWithProperty(db, 'a');
		expect(rows.map((row) => [row.property.name, row.unit.name])).toEqual([
			['Haus A', 'EG'],
			['Haus B', 'OG']
		]);
	});
});

describe('leaseInputOf', () => {
	it('turns a lease summary back into the input that created it', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: parking } = await seedUnit(db, 'a', { name: 'Stellplatz' });
		const tenantId = await seedTenant(db, 'a');
		const input = leaseInput(unitId, {
			tenantIds: [tenantId],
			extraUnitIds: [parking],
			notes: 'Hinweis'
		});
		const result = await createLease(db, contextA, input);
		if (!result.ok) throw new Error('setup failed');
		expect(leaseInputOf((await getLease(db, 'a', result.id))!)).toEqual(input);
	});
});

describe('endLease', () => {
	it('records the notice and the end date and logs it', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId));
		if (!result.ok) throw new Error('setup failed');

		expect(
			await endLease(db, contextA, result.id, {
				terminatedAt: '2025-03-02',
				terminatedBy: 'tenant',
				endDate: '2025-05-31'
			})
		).toBe('ended');
		expect(await getLease(db, 'a', result.id)).toMatchObject({
			terminatedAt: '2025-03-02',
			terminatedBy: 'tenant',
			endDate: '2025-05-31'
		});
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Mietvertrag EG links · Haus zum 31.05.2025 beendet (Kündigung vom 02.03.2025 durch Mieter)'
		]);
	});

	it('refuses an end before the start and a lease of another account', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const own = await createLease(db, contextA, leaseInput(unitId));
		const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!own.ok || !foreign.ok) throw new Error('setup failed');
		const input = {
			terminatedAt: '2024-10-01',
			terminatedBy: 'tenant' as const,
			endDate: '2024-12-31'
		};
		expect(await endLease(db, contextA, own.id, input)).toBe('before-start');
		expect(await endLease(db, contextA, foreign.id, { ...input, endDate: '2025-12-31' })).toBe(
			'missing'
		);
		expect((await getLease(db, 'b', foreign.id))!.endDate).toBeNull();
	});
});

describe('lease persons', () => {
	it('adds rows after the start, refuses duplicates and dates before the start', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId));
		if (!result.ok) throw new Error('setup failed');

		const added = await addLeasePersons(db, contextA, result.id, {
			validFrom: '2025-09-01',
			persons: 3,
			note: 'Kind geboren'
		});
		expect(added.ok).toBe(true);
		expect(
			await addLeasePersons(db, contextA, result.id, {
				validFrom: '2025-09-01',
				persons: 4,
				note: null
			})
		).toEqual({ ok: false, reason: 'duplicate' });
		expect(
			await addLeasePersons(db, contextA, result.id, {
				validFrom: '2025-01-01',
				persons: 4,
				note: null
			})
		).toEqual({ ok: false, reason: 'duplicate' });
		expect(
			await addLeasePersons(db, contextA, result.id, {
				validFrom: '2024-12-31',
				persons: 4,
				note: null
			})
		).toEqual({ ok: false, reason: 'before-start' });

		const rows = await listLeasePersons(db, 'a', result.id);
		expect(rows.map((row) => [row.validFrom, row.persons, row.note])).toEqual([
			['2025-01-01', 2, null],
			['2025-09-01', 3, 'Kind geboren']
		]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Personenstand ab 01.09.2025: 3 Personen'
		]);
	});

	it('deletes later rows but keeps the initial one', async () => {
		const { unitId } = await seedUnit(db, 'a');
		const result = await createLease(db, contextA, leaseInput(unitId));
		if (!result.ok) throw new Error('setup failed');
		const added = await addLeasePersons(db, contextA, result.id, {
			validFrom: '2025-09-01',
			persons: 1,
			note: null
		});
		if (!added.ok) throw new Error('setup failed');
		const [initial] = await listLeasePersons(db, 'a', result.id);

		expect(await deleteLeasePersons(db, contextA, result.id, initial.id)).toBe('initial');
		expect(await deleteLeasePersons(db, contextA, result.id, added.id)).toBe('deleted');
		expect(await deleteLeasePersons(db, contextA, result.id, added.id)).toBe('missing');
		expect((await listLeasePersons(db, 'a', result.id)).map((row) => row.id)).toEqual([initial.id]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'update'));
		expect(audit.at(-1)?.summary).toBe('Personenstand ab 01.09.2025 entfernt');
	});

	it('does not read or change the history of another account', async () => {
		const { unitId: foreignUnit } = await seedUnit(db, 'b');
		const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
		if (!foreign.ok) throw new Error('setup failed');
		expect(await listLeasePersons(db, 'a', foreign.id)).toEqual([]);
		expect(
			await addLeasePersons(db, contextA, foreign.id, {
				validFrom: '2025-09-01',
				persons: 1,
				note: null
			})
		).toEqual({ ok: false, reason: 'missing' });
		const [row] = await listLeasePersons(db, 'b', foreign.id);
		expect(await deleteLeasePersons(db, contextA, foreign.id, row.id)).toBe('missing');
		expect(await listLeasePersons(db, 'b', foreign.id)).toHaveLength(1);
	});
});
