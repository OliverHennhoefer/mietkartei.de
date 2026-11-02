import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import { createInvitation } from '#lib/server/invitations.ts';
import { requestRegistration } from '#lib/server/registration-requests.ts';
import { contextA, outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions as invitationActions } from '../einladung/[token]/+page.server';
import { actions as registrationActions } from '../registrieren/+page.server';
import { actions as registrationLinkActions } from '../registrieren/[token]/+page.server';
import { actions } from './+page.server';

// The password chosen when an account is created signs in right away, whichever way the account
// was created, also with spaces, umlauts, emoji or the longest allowed length.

const env = vi.hoisted(() => ({
	FREE_ACCOUNT_EMAILS: '',
	REGISTRATION_EMAILS: '',
	SETUP_CODE: '',
	HOSTED: false,
	ORIGIN: '',
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: '',
	STRIPE_YEARLY_PRICE_ID: '',
	TRIAL_FINGERPRINT_KEY: '',
	TURNSTILE_SITE_KEY: '',
	TURNSTILE_SECRET_KEY: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	env.REGISTRATION_EMAILS = '';
	env.SETUP_CODE = '';
});

const passwords = ['lang-genug-1234', '  mit Leerzeichen  ', 'Ümläüt-ß-€-😀-pass', 'a'.repeat(200)];

function submit(
	action: (event: never) => unknown,
	form: Record<string, string>,
	params: Record<string, string> = {}
) {
	return outcome(() => action(routeEvent(db, { user: null, params, form })));
}

function signIn(email: string, password: string) {
	return submit(actions.default, { email, password });
}

describe('the first password', () => {
	it.each(passwords)('signs in after the registration link: %j', async (password) => {
		env.REGISTRATION_EMAILS = 'neu@example.org';
		const { token } = (await requestRegistration(db, 'Neu@Example.org'))!;
		expect(
			await submit(
				registrationLinkActions.default,
				{ password, passwordConfirm: password },
				{ token }
			)
		).toEqual({ redirect: '/' });
		expect(await signIn('neu@example.org', password)).toEqual({ redirect: '/' });
		expect(await signIn(' NEU@example.org ', password)).toEqual({ redirect: '/' });
	});

	it.each(passwords)('signs in after an invitation: %j', async (password) => {
		const created = await createInvitation(db, contextA, { email: 'neu@example.org' });
		if (!created.ok) throw new Error(created.reason);
		expect(
			await submit(
				invitationActions.default,
				{ name: 'Max', password, passwordConfirm: password },
				{ token: created.token }
			)
		).toEqual({ redirect: '/' });
		expect(await signIn('neu@example.org', password)).toEqual({ redirect: '/' });
	});

	it.each(passwords)(
		'signs in after the first registration with a setup code: %j',
		async (password) => {
			env.SETUP_CODE = 'kanal-tulpe-42';
			await db.delete(users);
			expect(
				await submit(registrationActions.default, {
					email: 'neu@example.org',
					password,
					setupCode: 'kanal-tulpe-42'
				})
			).toEqual({ redirect: '/' });
			expect(await signIn('neu@example.org', password)).toEqual({ redirect: '/' });
			expect(await signIn('neu@example.org', 'kanal-tulpe-42')).toMatchObject({ fail: 400 });
		}
	);
});
