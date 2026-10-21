import { eq } from 'drizzle-orm';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addressLines,
	deleteAccount,
	getLandlord,
	landlordAddress,
	updateLandlord
} from './accounts';
import type { Database } from './db';
import {
	accounts,
	auditLog,
	costCategories,
	documents,
	emailChanges,
	invitations,
	leaseTenants,
	leases,
	loginAttempts,
	passwordResets,
	payments,
	properties,
	rentCharges,
	sessions,
	tenants,
	units,
	users
} from './db/schema';
import { storeDocument } from './documents';
import { createPayment, ensureCharges } from './ledger';
import { createLease } from './leases';
import { openFileStorage } from './storage/fs';
import type { Storage } from './storage';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;
let root: string;
let storage: Storage;

beforeEach(async () => {
	db = await testDatabase();
	root = await mkdtemp(join(tmpdir(), 'mietkartei-accounts-'));
	storage = openFileStorage(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('landlordAddress', () => {
	it('falls back to the account name and reports an incomplete address', async () => {
		const address = await landlordAddress(db, 'a');
		expect(address).toMatchObject({ name: 'Konto A', street: null, complete: false });
		expect(addressLines(address)).toEqual(['Konto A']);
	});

	it('uses the landlord fields when they are set', async () => {
		await db
			.update(accounts)
			.set({
				landlordName: 'Erika Vermieter',
				street: 'Hauptstraße 1',
				postalCode: '10115',
				city: 'Berlin'
			})
			.where(eq(accounts.id, 'a'));
		const address = await landlordAddress(db, 'a');
		expect(address.complete).toBe(true);
		expect(addressLines(address)).toEqual(['Erika Vermieter', 'Hauptstraße 1', '10115 Berlin']);
	});
});

describe('updateLandlord and getLandlord', () => {
	const empty = {
		landlordName: null,
		street: null,
		postalCode: null,
		city: null,
		iban: null,
		bankName: null
	};
	const block = {
		landlordName: 'Erika Vermieter',
		street: 'Hauptstraße 1',
		postalCode: '10115',
		city: 'Berlin',
		iban: 'DE89370400440532013000',
		bankName: 'Musterbank'
	};

	it('stores the sender block of the own account with an audit entry', async () => {
		expect(await getLandlord(db, 'a')).toEqual(empty);
		await updateLandlord(db, contextA, block);
		expect(await getLandlord(db, 'a')).toEqual(block);
		expect(await landlordAddress(db, 'a')).toMatchObject({
			complete: true,
			iban: 'DE89370400440532013000',
			bankName: 'Musterbank'
		});
		const entries = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			userId: 'user-a',
			entity: 'account',
			entityId: 'a',
			action: 'update',
			summary: 'Absender (Vermieter) für Briefe und Abrechnungen geändert'
		});
	});

	it('empties fields set to null and does not leak into another account', async () => {
		await updateLandlord(db, contextB, block);
		await updateLandlord(db, contextA, { ...block, street: 'Nebenweg 2' });
		await updateLandlord(db, contextA, { ...block, landlordName: null });
		expect(await getLandlord(db, 'a')).toEqual({ ...block, landlordName: null });
		// Without a landlord name the letters fall back to the account name.
		expect((await landlordAddress(db, 'a')).name).toBe('Konto A');
		// Account b keeps its own block, and its log only its own line.
		expect(await getLandlord(db, 'b')).toEqual(block);
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'b'))).toHaveLength(1);
		expect(await getLandlord(db, 'missing')).toEqual(empty);
	});
});

describe('deleteAccount', () => {
	async function seedAccount(context: { accountId: string; userId: string }) {
		const { unitId } = await seedUnit(db, context.accountId);
		const tenantId = await seedTenant(db, context.accountId);
		const created = await createLease(db, context, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!created.ok) throw new Error(created.reason);
		const lease = { id: created.id };
		await ensureCharges(db, context.accountId, [lease.id], '2025-03');
		await createPayment(db, context, {
			leaseId: lease.id,
			amount: 80000,
			date: '2025-01-03',
			source: 'manual',
			note: null
		});
		await db.insert(costCategories).values({ accountId: context.accountId, name: 'Grundsteuer' });
		const expiresAt = new Date('2030-01-01');
		const [{ email }] = await db
			.select({ email: users.email })
			.from(users)
			.where(eq(users.id, context.userId));
		await db.insert(sessions).values({
			id: `session-${context.accountId}`,
			userId: context.userId,
			expiresAt
		});
		await db.insert(passwordResets).values({
			id: `reset-${context.accountId}`,
			userId: context.userId,
			expiresAt
		});
		await db.insert(emailChanges).values({
			id: `change-${context.accountId}`,
			accountId: context.accountId,
			userId: context.userId,
			email: `neu-${email}`,
			expiresAt
		});
		await db.insert(invitations).values({
			accountId: context.accountId,
			email: `eingeladen-${email}`,
			tokenHash: `invitation-${context.accountId}`,
			expiresAt
		});
		await db.insert(loginAttempts).values({ email, failures: 1, firstFailureAt: new Date() });
		const stored = await storeDocument(
			db,
			context,
			{
				name: 'Mietvertrag.pdf',
				mimeType: 'application/pdf',
				bytes: new TextEncoder().encode('%PDF-1.4 test'),
				links: { leaseId: lease.id }
			},
			{ storage }
		);
		expect(stored.ok).toBe(true);
		return lease.id;
	}

	it('removes every row and file of the account and nothing of another account', async () => {
		await seedAccount(contextA);
		const leaseB = await seedAccount(contextB);
		// A file without a row, as a manager's upload that lands while the account is deleted.
		await storage.put('a/hochgeladen-waehrenddessen', new TextEncoder().encode('x'), 'text/plain');

		expect(await deleteAccount(db, 'a', { storage })).toBe(true);

		expect(await db.select().from(accounts)).toEqual([expect.objectContaining({ id: 'b' })]);
		expect(await db.select().from(users)).toEqual([expect.objectContaining({ id: 'user-b' })]);
		for (const table of [sessions, passwordResets]) {
			expect(await db.select({ userId: table.userId }).from(table)).toEqual([{ userId: 'user-b' }]);
		}
		expect(await db.select({ email: loginAttempts.email }).from(loginAttempts)).toEqual([
			{ email: 'b@example.org' }
		]);
		for (const table of [
			properties,
			units,
			tenants,
			leases,
			rentCharges,
			payments,
			auditLog,
			invitations,
			emailChanges,
			documents
		]) {
			const rows = await db.select({ accountId: table.accountId }).from(table);
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.every((row) => row.accountId === 'b')).toBe(true);
		}
		expect(await db.select().from(leaseTenants)).toEqual([
			expect.objectContaining({ leaseId: leaseB })
		]);
		expect(await readdir(root)).toEqual(['b']);
	});

	it('keeps every row and file when the batch fails', async () => {
		await seedAccount(contextA);
		const leaseB = await seedAccount(contextB);
		// A lease of account b on a unit of a: the restrict key stops the batch at a's units.
		const [unitA] = await db.select({ id: units.id }).from(units).where(eq(units.accountId, 'a'));
		await db.update(leases).set({ unitId: unitA.id }).where(eq(leases.id, leaseB));
		const rowsBefore = await db.select().from(documents);

		await expect(deleteAccount(db, 'a', { storage })).rejects.toThrow();
		expect(await db.select().from(accounts)).toHaveLength(2);
		expect(await db.select().from(documents)).toEqual(rowsBefore);
		expect((await readdir(root)).sort()).toEqual(['a', 'b']);
		expect(await readdir(join(root, 'a'))).toHaveLength(2);
	});

	it('reports a missing account', async () => {
		expect(await deleteAccount(db, 'nobody', { storage })).toBe(false);
		expect((await db.select().from(accounts)).length).toBe(2);
	});
});
