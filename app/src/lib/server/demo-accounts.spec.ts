import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateSession } from './auth';
import type { Database } from './db';
import { accounts, outbox, properties, users } from './db/schema';
import { DEMO_LIFETIME, deleteExpiredDemoAccounts, startDemo } from './demo-accounts';
import { memoryStorage, testDatabase } from './testing';

let db: Database;
const storage = memoryStorage();

beforeEach(async () => {
	db = await testDatabase();
});

async function ageAccount(accountId: string, age: number) {
	await db
		.update(accounts)
		.set({ createdAt: new Date(Date.now() - age) })
		.where(eq(accounts.id, accountId));
}

describe('startDemo', () => {
	it('signs a new owner into an account of their own with the demo data', async () => {
		const { token } = await startDemo(db, { storage });
		const session = await validateSession(db, token);
		expect(session?.user).toMatchObject({ role: 'owner', name: 'Demo' });
		const accountId = session!.user.accountId;
		expect(['a', 'b']).not.toContain(accountId);
		expect(session!.user.email).toMatch(/^demo-[0-9a-f-]+@demo\.invalid$/);
		const rows = await db.select().from(properties).where(eq(properties.accountId, accountId));
		expect(rows).toHaveLength(3);
		// The letters of the demo have a sender.
		const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
		expect(account).toMatchObject({ landlordName: 'Katrin Hoffmann', city: 'Berlin' });
	});

	it('deletes expired demo accounts first', async () => {
		const first = await validateSession(db, (await startDemo(db, { storage })).token);
		await ageAccount(first!.user.accountId, DEMO_LIFETIME + 1000);
		await startDemo(db, { storage });
		const ids = (await db.select({ id: accounts.id }).from(accounts)).map((row) => row.id);
		expect(ids).not.toContain(first!.user.accountId);
		expect(ids).toHaveLength(3);
	});
});

describe('deleteExpiredDemoAccounts', () => {
	it('keeps fresh demo accounts and every account that is not a demo', async () => {
		const fresh = await validateSession(db, (await startDemo(db, { storage })).token);
		await ageAccount(fresh!.user.accountId, DEMO_LIFETIME - 60_000);
		await ageAccount('a', DEMO_LIFETIME * 10);
		expect(await deleteExpiredDemoAccounts(db, Date.now(), { storage })).toBe(0);
		expect(await db.select({ id: accounts.id }).from(accounts)).toHaveLength(3);
	});

	it('deletes at most five accounts at a time', async () => {
		const sessions = [];
		for (let index = 0; index < 7; index++) {
			sessions.push(await validateSession(db, (await startDemo(db, { storage })).token));
		}
		for (const [index, session] of sessions.entries()) {
			await ageAccount(session!.user.accountId, DEMO_LIFETIME * 2 + index * 1000);
		}
		expect(await deleteExpiredDemoAccounts(db, Date.now(), { storage })).toBe(5);
		expect(await deleteExpiredDemoAccounts(db, Date.now(), { storage })).toBe(2);
		const left = await db
			.select({ count: sql<number>`count(*)` })
			.from(users)
			.where(sql`${users.email} like 'demo-%'`);
		expect(left[0].count).toBe(0);
	});

	it('deletes the stored mails after the same lifetime', async () => {
		const mail = { to: 'x@example.org', subject: 'Einladung', text: '…' };
		await db.insert(outbox).values([
			{ ...mail, createdAt: new Date(Date.now() - DEMO_LIFETIME - 1000) },
			{ ...mail, subject: 'Neu' }
		]);
		await deleteExpiredDemoAccounts(db, Date.now(), { storage });
		const left = await db.select({ subject: outbox.subject }).from(outbox);
		expect(left).toEqual([{ subject: 'Neu' }]);
	});
});
