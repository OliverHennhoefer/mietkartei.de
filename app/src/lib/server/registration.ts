import { REGISTRATION_EMAILS } from '$app/env/private';
import type { Database } from './db';
import { hasUsers } from './auth';

// Who may create an account. With REGISTRATION_EMAILS set, exactly the listed addresses may, each
// once. Without it, a self-hosted instance lets only its first person register, who takes over the
// existing data; the hosted variant (cloudflare target) lets nobody, so no stranger can win the race
// for the first account of an empty database.

export type RegistrationRule = {
	/** Normalized like the email of a registration: trimmed and lower case. */
	emails: readonly string[];
	hosted: boolean;
	hasUsers: boolean;
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
		hosted: __DEPLOY_TARGET__ === 'cloudflare',
		hasUsers: await hasUsers(db)
	};
}
