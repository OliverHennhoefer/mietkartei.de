import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from './auth';
import type { Database } from './db';
import { accounts, auditLog, leases, portalLinks } from './db/schema';
import {
	createPortalLink,
	findPortal,
	getPortalLink,
	portalLinkMail,
	revokePortalLink
} from './portal';
import { contextA, contextB, seedLease, seedUnit, testDatabase } from './testing';

let db: Database;
let leaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a', { name: 'EG links', propertyName: 'Haus' });
	leaseId = await seedLease(db, 'a', unitId);
});

describe('createPortalLink', () => {
	it('stores only the hash of the token and opens the portal with the token', async () => {
		const token = await createPortalLink(db, contextA, leaseId);
		expect(token).toMatch(/^[\w-]{43}$/);
		const [row] = await db.select().from(portalLinks);
		expect(row).toMatchObject({ accountId: 'a', leaseId, tokenHash: await hashToken(token!) });
		expect(await getPortalLink(db, 'a', leaseId)).toEqual({ createdAt: row.createdAt });

		expect(await findPortal(db, token!)).toEqual({
			accountId: 'a',
			leaseId,
			unitName: 'EG links',
			propertyName: 'Haus',
			address: 'Lindenstraße 4, 10115 Berlin',
			landlord: 'Konto A'
		});
		const [entry] = await db.select().from(auditLog).where(eq(auditLog.entity, 'portalLink'));
		expect(entry.summary).toBe('Mieterportal-Link für EG links · Haus erzeugt');
	});

	it('names the landlord as printed on letters when the account has one', async () => {
		await db.update(accounts).set({ landlordName: 'Max Vermieter' }).where(eq(accounts.id, 'a'));
		const token = await createPortalLink(db, contextA, leaseId);
		expect((await findPortal(db, token!))?.landlord).toBe('Max Vermieter');
	});

	it('replaces the older link of the lease', async () => {
		const first = await createPortalLink(db, contextA, leaseId);
		const second = await createPortalLink(db, contextA, leaseId);
		expect(await findPortal(db, first!)).toBeUndefined();
		expect(await findPortal(db, second!)).toMatchObject({ leaseId });
		expect(await db.select().from(portalLinks)).toHaveLength(1);
	});

	it('refuses a lease of another account', async () => {
		expect(await createPortalLink(db, contextB, leaseId)).toBeUndefined();
		expect(await db.select().from(portalLinks)).toHaveLength(0);
	});
});

describe('revokePortalLink', () => {
	it('locks the link out once', async () => {
		const token = await createPortalLink(db, contextA, leaseId);
		expect(await revokePortalLink(db, contextB, leaseId)).toBe(false);
		expect(await revokePortalLink(db, contextA, leaseId)).toBe(true);
		expect(await findPortal(db, token!)).toBeUndefined();
		expect(await getPortalLink(db, 'a', leaseId)).toBeUndefined();
		expect(await revokePortalLink(db, contextA, leaseId)).toBe(false);
	});

	it('goes with its lease', async () => {
		const token = await createPortalLink(db, contextA, leaseId);
		await db.delete(leases).where(eq(leases.id, leaseId));
		expect(await findPortal(db, token!)).toBeUndefined();
	});
});

describe('findPortal', () => {
	it('opens nothing for strings that cannot be a token', async () => {
		expect(await findPortal(db, '')).toBeUndefined();
		expect(await findPortal(db, 'kurz')).toBeUndefined();
		expect(await findPortal(db, 'x'.repeat(43))).toBeUndefined();
	});
});

describe('portalLinkMail', () => {
	it('addresses the tenant with the link and the unit', () => {
		const mail = portalLinkMail(
			'mieter@example.org',
			{ unitName: 'EG links', propertyName: 'Haus', landlord: 'Max Vermieter' },
			'https://app.example.org/mieterportal/abc'
		);
		expect(mail.to).toBe('mieter@example.org');
		expect(mail.subject).toBe('Mieterportal für EG links · Haus');
		expect(mail.text).toContain('Max Vermieter hat für Ihre Wohnung EG links (Haus)');
		expect(mail.text).toContain('https://app.example.org/mieterportal/abc');
	});
});
