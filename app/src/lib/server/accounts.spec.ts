import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addressLines, getLandlord, landlordAddress, updateLandlord } from './accounts';
import type { Database } from './db';
import { accounts, auditLog } from './db/schema';
import { contextA, contextB, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
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
	const empty = { landlordName: null, street: null, postalCode: null, city: null };
	const block = {
		landlordName: 'Erika Vermieter',
		street: 'Hauptstraße 1',
		postalCode: '10115',
		city: 'Berlin'
	};

	it('stores the sender block of the own account with an audit entry', async () => {
		expect(await getLandlord(db, 'a')).toEqual(empty);
		await updateLandlord(db, contextA, block);
		expect(await getLandlord(db, 'a')).toEqual(block);
		expect((await landlordAddress(db, 'a')).complete).toBe(true);
		const entries = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			userId: 'user-a',
			entity: 'account',
			entityId: 'a',
			action: 'update',
			summary: 'Absender (Vermieter) für Briefe geändert'
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
