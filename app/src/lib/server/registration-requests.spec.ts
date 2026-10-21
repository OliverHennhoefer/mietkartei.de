import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticate, hashToken } from './auth';
import type { Database } from './db';
import { registrationRequests, users } from './db/schema';
import {
	MAX_OPEN_REGISTRATION_REQUESTS,
	REGISTRATION_REQUEST_LIFETIME,
	completeRegistration,
	findRegistrationRequest,
	registrationMail,
	requestRegistration
} from './registration-requests';
import { testDatabase } from './testing';

const password = 'richtig-langes-passwort';
const now = Date.parse('2026-03-01T10:00:00Z');

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

describe('requestRegistration', () => {
	it('stores only the address and the hash of the token, valid for one day', async () => {
		const request = await requestRegistration(db, ' Neu@Example.org ', now);
		expect(request?.email).toBe('neu@example.org');
		const [row] = await db.select().from(registrationRequests);
		expect(row.id).toBe(await hashToken(request!.token));
		expect(row.email).toBe('neu@example.org');
		expect(row.expiresAt.getTime()).toBe(now + REGISTRATION_REQUEST_LIFETIME);
		// No account before the link is used.
		expect(await db.select().from(users).where(eq(users.email, 'neu@example.org'))).toEqual([]);
	});

	it('stores nothing for an address that has an account', async () => {
		expect(await requestRegistration(db, 'A@example.org', now)).toBeUndefined();
		expect(await db.select().from(registrationRequests)).toEqual([]);
	});

	it('limits the open requests per address', async () => {
		for (let i = 0; i < MAX_OPEN_REGISTRATION_REQUESTS; i++) {
			expect(await requestRegistration(db, 'neu@example.org', now)).toBeDefined();
		}
		expect(await requestRegistration(db, 'neu@example.org', now)).toBeUndefined();
		// Expired requests no longer count, and the next request deletes them.
		const later = now + REGISTRATION_REQUEST_LIFETIME;
		expect(await requestRegistration(db, 'neu@example.org', later)).toBeDefined();
		expect(await db.select().from(registrationRequests)).toHaveLength(1);
	});
});

describe('findRegistrationRequest', () => {
	it('finds a request by its token until it expires', async () => {
		const { token } = (await requestRegistration(db, 'neu@example.org', now))!;
		expect(await findRegistrationRequest(db, token, now)).toMatchObject({
			email: 'neu@example.org'
		});
		expect(
			await findRegistrationRequest(db, token, now + REGISTRATION_REQUEST_LIFETIME)
		).toBeUndefined();
		expect(await findRegistrationRequest(db, 'unbekannt', now)).toBeUndefined();
	});
});

describe('completeRegistration', () => {
	it('creates the account with the password of the link page and uses up every link', async () => {
		const first = (await requestRegistration(db, 'neu@example.org', now))!;
		const second = (await requestRegistration(db, 'neu@example.org', now))!;

		const registered = await completeRegistration(db, first.email, password);
		expect(registered.ok).toBe(true);
		expect(await authenticate(db, 'neu@example.org', password)).toBeDefined();
		expect(await findRegistrationRequest(db, first.token, now)).toBeUndefined();
		expect(await findRegistrationRequest(db, second.token, now)).toBeUndefined();
	});

	it('refuses an address that got an account in the meantime', async () => {
		await requestRegistration(db, 'neu@example.org', now);
		await db.update(users).set({ email: 'neu@example.org' }).where(eq(users.id, 'user-b'));

		expect(await completeRegistration(db, 'neu@example.org', password)).toEqual({
			ok: false,
			reason: 'email-taken'
		});
		expect(await db.select().from(registrationRequests)).toEqual([]);
	});
});

describe('registrationMail', () => {
	it('carries the link', () => {
		const mail = registrationMail('neu@example.org', 'https://app.example/registrieren/abc');
		expect(mail.to).toBe('neu@example.org');
		expect(mail.text).toContain('https://app.example/registrieren/abc');
	});
});
