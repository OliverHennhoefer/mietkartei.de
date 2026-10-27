import { describe, expect, it } from 'vitest';
import {
	mayRegister,
	parseRegistrationEmails,
	registrationOffered,
	setupCodeMatches,
	setupCodeRequired
} from './registration';

const listed = { emails: ['oliver@example.org'], hosted: true, hasUsers: true, setupCode: '' };

describe('registration rule', () => {
	it('reads the list separated by commas or whitespace, in lower case', () => {
		expect(
			parseRegistrationEmails(' Oliver@Example.org,zweite@example.org\nDritte@example.org ')
		).toEqual(['oliver@example.org', 'zweite@example.org', 'dritte@example.org']);
		expect(parseRegistrationEmails('')).toEqual([]);
	});

	it('lets only the listed addresses register when a list is set', () => {
		expect(registrationOffered(listed)).toBe(true);
		expect(mayRegister(listed, ' Oliver@Example.org')).toBe(true);
		expect(mayRegister(listed, 'fremd@example.org')).toBe(false);
		const selfHostedEmpty = { ...listed, hosted: false, hasUsers: false };
		expect(mayRegister(selfHostedEmpty, 'fremd@example.org')).toBe(false);
	});

	it('lets the first person register on a self-hosted instance without a list', () => {
		const empty = { emails: [], hosted: false, hasUsers: false, setupCode: '' };
		expect(registrationOffered(empty)).toBe(true);
		expect(mayRegister(empty, 'erste@example.org')).toBe(true);
		const taken = { ...empty, hasUsers: true };
		expect(registrationOffered(taken)).toBe(false);
		expect(mayRegister(taken, 'zweite@example.org')).toBe(false);
	});

	it('lets nobody register on the hosted variant without a list, even into an empty database', () => {
		const hosted = { emails: [], hosted: true, hasUsers: false, setupCode: '' };
		expect(registrationOffered(hosted)).toBe(false);
		expect(mayRegister(hosted, 'erste@example.org')).toBe(false);
	});

	it('asks the first person for the setup code when one is set', () => {
		const fresh = { emails: [], hosted: false, hasUsers: false, setupCode: 'kanal-tulpe-42' };
		expect(setupCodeRequired(fresh)).toBe(true);
		expect(setupCodeRequired({ ...fresh, setupCode: '' })).toBe(false);
		// A list of addresses confirms them by mail instead.
		expect(setupCodeRequired({ ...fresh, emails: ['oliver@example.org'] })).toBe(false);
		expect(setupCodeMatches(fresh, ' kanal-tulpe-42 ')).toBe(true);
		expect(setupCodeMatches(fresh, 'kanal-tulpe-43')).toBe(false);
		expect(setupCodeMatches(fresh, 'kanal-tulpe-42x')).toBe(false);
		expect(setupCodeMatches(fresh, '')).toBe(false);
		expect(setupCodeMatches(fresh, null)).toBe(false);
		expect(setupCodeMatches({ ...fresh, setupCode: '' }, '')).toBe(false);
	});
});
