import { HOSTED, REGISTRATION_EMAILS, SETUP_CODE } from '$app/env/private';
import type { Database } from './db';
import { hasUsers } from './auth';

// Who may create an account. With REGISTRATION_EMAILS set, exactly the listed addresses may, each
// once. Without it, a self-hosted instance lets only its first person register, who takes over the
// existing data; the hosted variant (HOSTED) lets nobody, so no stranger can win the race for the
// first account of an empty database. A self-hosted instance that is public from the start, such as
// one on workers.dev, closes that race with SETUP_CODE, which the first person must enter.

export type RegistrationRule = {
	/** Normalized like the email of a registration: trimmed and lower case. */
	emails: readonly string[];
	hosted: boolean;
	hasUsers: boolean;
	/** The code the first person must enter; empty when none is needed. */
	setupCode: string;
};

/** The addresses of REGISTRATION_EMAILS, separated by commas or whitespace. */
export function parseRegistrationEmails(value: string): string[] {
	return value
		.split(/[\s,]+/)
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
}

/** Whether the form is offered at all; the address is checked on submit. */
export function registrationOffered(rule: RegistrationRule): boolean {
	return rule.emails.length > 0 || (!rule.hosted && !rule.hasUsers);
}

/** Whether this address may register. */
export function mayRegister(rule: RegistrationRule, email: string): boolean {
	if (rule.emails.length > 0) return rule.emails.includes(email.trim().toLowerCase());
	return !rule.hosted && !rule.hasUsers;
}

export async function registrationRule(db: Database): Promise<RegistrationRule> {
	return {
		emails: parseRegistrationEmails(REGISTRATION_EMAILS),
		hosted: HOSTED,
		hasUsers: await hasUsers(db),
		setupCode: SETUP_CODE
	};
}

/** Whether the form asks for the setup code: for the first person, when one is set. */
export function setupCodeRequired(rule: RegistrationRule): boolean {
	return rule.emails.length === 0 && rule.setupCode !== '';
}

/** Whether the entered code is the setup code, compared in constant time. */
export function setupCodeMatches(rule: RegistrationRule, entered: unknown): boolean {
	const expected = rule.setupCode;
	if (expected === '' || typeof entered !== 'string') return false;
	const given = entered.trim();
	let difference = expected.length ^ given.length;
	for (let index = 0; index < expected.length; index += 1) {
		// Past the end of the entered code, charCodeAt gives NaN, which | 0 turns into 0.
		difference |= expected.charCodeAt(index) ^ (given.charCodeAt(index) | 0);
	}
	return difference === 0;
}
