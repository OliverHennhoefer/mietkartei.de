import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, signIn } from '#lib/server/auth.ts';
import type { Database } from '#lib/server/db/index.ts';
import { emailChanges, outbox, sessions, users } from '#lib/server/db/schema.ts';
import {
	ownerA,
	outcome,
	PASSWORD,
	routeEvent,
	setPassword,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ ORIGIN: '', MAIL_TRANSPORT: 'outbox' }));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	await setPassword(db, 'user-a');
	Object.assign(env, { ORIGIN: '', MAIL_TRANSPORT: 'outbox' });
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function userA() {
	const [row] = await db.select().from(users).where(eq(users.id, 'user-a'));
	return row;
}

function profile(form: Record<string, string>, url?: string) {
	return outcome(() => actions.profile(routeEvent(db, { form, url })));
}

describe('load', () => {
	it('shows the user and the landlord block of the account', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: { user: { name: null, email: 'a@example.org' }, landlord: { landlordName: null } }
		});
	});
});

describe('profile', () => {
	it('saves the name without a password', async () => {
		expect(await profile({ name: 'Anna', email: 'a@example.org' })).toEqual({
			data: { form: 'profile', saved: true, pendingEmail: undefined }
		});
		expect((await userA()).name).toBe('Anna');
	});

	it('mails a link to a new address and keeps the old one until it is confirmed', async () => {
		const result = await profile({
			name: '',
			email: 'neu@example.org',
			currentPassword: PASSWORD
		});
		expect(result).toEqual({
			data: { form: 'profile', saved: true, pendingEmail: 'neu@example.org' }
		});
		expect((await userA()).email).toBe('a@example.org');
		const mails = await db.select().from(outbox);
		expect(mails.map((mail) => mail.to).sort()).toEqual(['a@example.org', 'neu@example.org']);
		expect(mails.find((mail) => mail.to === 'neu@example.org')?.text).toMatch(
			/http:\/\/localhost\/e-mail-bestaetigen\/[\w-]{43}/
		);
	});

	it('maps each refusal of an address change to its field', async () => {
		const change = (email: string, currentPassword: string) => profile({ email, currentPassword });
		expect(await change('neu@example.org', 'falsch')).toMatchObject({
			fail: 400,
			data: { errors: { currentPassword: 'Das Passwort stimmt nicht.' } }
		});
		expect(await change('b@example.org', PASSWORD)).toMatchObject({
			fail: 400,
			data: { errors: { email: expect.stringContaining('schon ein Zugangskonto') } }
		});
		expect(await change('neu@example.org', '')).toMatchObject({ fail: 400 });
	});

	it('refuses a change it cannot mail a trustworthy link for', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = await profile(
			{ email: 'neu@example.org', currentPassword: PASSWORD },
			'http://evil.example/einstellungen/profil'
		);
		expect(result).toMatchObject({ fail: 503 });
		expect(await db.select().from(emailChanges)).toEqual([]);
	});

	it('withdraws the change when the mail cannot be sent', async () => {
		env.MAIL_TRANSPORT = 'resend';
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 500 }));
		expect(await profile({ email: 'neu@example.org', currentPassword: PASSWORD })).toMatchObject({
			fail: 502
		});
		expect(await db.select().from(emailChanges)).toEqual([]);
	});
});

describe('password', () => {
	const fields = { password: 'neu-und-lang-1', passwordConfirm: 'neu-und-lang-1' };

	it('changes the password and keeps only this session', async () => {
		const mine = await createSession(db, 'user-a');
		await createSession(db, 'user-a');
		const cookies = new Map([['session', mine.token]]);
		const result = await outcome(() =>
			actions.password(routeEvent(db, { cookies, form: { currentPassword: PASSWORD, ...fields } }))
		);
		expect(result).toEqual({ data: { form: 'password', saved: true } });
		expect(await signIn(db, 'a@example.org', fields.password)).toMatchObject({ ok: true });
		expect(await db.select().from(sessions)).toHaveLength(1);
	});

	it('refuses a wrong current password', async () => {
		const result = await outcome(() =>
			actions.password(routeEvent(db, { form: { currentPassword: 'falsch', ...fields } }))
		);
		expect(result).toEqual({
			fail: 400,
			data: { form: 'password', errors: { currentPassword: 'Das aktuelle Passwort stimmt nicht.' } }
		});
		expect(await outcome(() => actions.password(routeEvent(db, { form: fields })))).toMatchObject({
			fail: 400
		});
	});

	it('answers a user that no longer exists', async () => {
		const gone = { ...ownerA, id: 'gone' };
		const result = await outcome(() =>
			actions.password(
				routeEvent(db, { user: gone, form: { currentPassword: PASSWORD, ...fields } })
			)
		);
		expect(result).toMatchObject({
			fail: 400,
			data: { errors: { currentPassword: expect.stringContaining('nicht gefunden') } }
		});
	});
});

describe('landlord', () => {
	it('saves the sender block and refuses a malformed postal code', async () => {
		const form = {
			landlordName: 'Anna Beispiel',
			street: 'Weg 1',
			postalCode: '10115',
			city: 'Berlin'
		};
		expect(await outcome(() => actions.landlord(routeEvent(db, { form })))).toEqual({
			data: { form: 'landlord', saved: true }
		});
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: { landlord: { landlordName: 'Anna Beispiel', postalCode: '10115' } }
		});
		expect(
			await outcome(() => actions.landlord(routeEvent(db, { form: { ...form, postalCode: '1' } })))
		).toMatchObject({ fail: 400, data: { form: 'landlord' } });
	});
});
