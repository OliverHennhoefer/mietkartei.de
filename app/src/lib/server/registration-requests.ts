import { and, count, eq, gt, lte } from 'drizzle-orm';
import {
	generateToken,
	hashToken,
	normalizeEmail,
	registerUser,
	type RegisterResult
} from './auth';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { registrationRequests, users } from './db/schema';
import type { Mail } from './mail';

// Registration with a confirmed address (Registrierung bestätigen): the form takes only the
// address and mails a link to it; the password is chosen on the page of the link, which creates
// the account. So nobody can take an address they cannot read mail for, nor set the password of
// an account that someone else creates by opening an unsolicited link. Only the SHA-256 of the
// token is stored, as the row's id.

const DAY = 24 * 60 * 60 * 1000;
export const REGISTRATION_REQUEST_LIFETIME = DAY;
/** Open requests per address, so the form cannot be used to flood a mailbox. */
export const MAX_OPEN_REGISTRATION_REQUESTS = 3;

/**
 * Stores a request and returns the token for the mail, or nothing when a user already has the
 * address or it has MAX_OPEN_REGISTRATION_REQUESTS open requests. The caller answers the same in
 * every case, so the form says nothing about which addresses have an account.
 */
export async function requestRegistration(
	db: Database,
	email: string,
	now = Date.now()
): Promise<{ token: string; email: string } | undefined> {
	email = normalizeEmail(email);
	const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (taken) return undefined;
	const [open] = await db
		.select({ value: count() })
		.from(registrationRequests)
		.where(
			and(eq(registrationRequests.email, email), gt(registrationRequests.expiresAt, new Date(now)))
		);
	if (open.value >= MAX_OPEN_REGISTRATION_REQUESTS) return undefined;
	const token = generateToken();
	await runBatch(db, [
		db.delete(registrationRequests).where(lte(registrationRequests.expiresAt, new Date(now))),
		db.insert(registrationRequests).values({
			id: await hashToken(token),
			email,
			expiresAt: new Date(now + REGISTRATION_REQUEST_LIFETIME),
			createdAt: new Date(now)
		})
	]);
	return { token, email };
}

/** The request behind a token, when it exists and has not expired. */
export async function findRegistrationRequest(
	db: Database,
	token: string,
	now = Date.now()
): Promise<{ id: string; email: string } | undefined> {
	const [row] = await db
		.select({ id: registrationRequests.id, email: registrationRequests.email })
		.from(registrationRequests)
		.where(
			and(
				eq(registrationRequests.id, await hashToken(token)),
				gt(registrationRequests.expiresAt, new Date(now))
			)
		);
	return row;
}

/**
 * Creates the account of a confirmed request with the password chosen on the link's page. Every
 * request for the address is deleted once a user has it, so no other link of it stays valid.
 */
export async function completeRegistration(
	db: Database,
	email: string,
	password: string
): Promise<RegisterResult> {
	const registered = await registerUser(db, email, password);
	if (registered.ok || registered.reason === 'email-taken') {
		await db.delete(registrationRequests).where(eq(registrationRequests.email, email));
	}
	return registered;
}

/** The mail with the link; `link` is the absolute URL of /registrieren/<token>. */
export function registrationMail(to: string, link: string): Mail {
	return {
		to,
		subject: 'Registrierung bestätigen · mietkartei',
		text:
			'Hallo,\n\n' +
			'mit dieser E-Mail-Adresse wurde ein Konto bei mietkartei beantragt. Mit diesem Link ' +
			'bestätigst du die Adresse, wählst dein Passwort und legst das Konto an; er gilt einen Tag:\n\n' +
			`${link}\n\n` +
			'Wenn du das nicht warst, kannst du diese E-Mail ignorieren; dann wird kein Konto angelegt.\n'
	};
}
