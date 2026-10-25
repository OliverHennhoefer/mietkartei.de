import { describe, expect, it } from 'vitest';
import type { SessionUser } from './auth';
import { auditContext, requireAccount, requireOwner, requireUser } from './session';

/** The locals of a signed-in owner, overridden by `user`; null for a signed-out visitor. */
function locals(user: Partial<SessionUser> | null = {}): App.Locals {
	return {
		user: user
			? ({
					id: 'user-a',
					email: 'a@example.org',
					accountId: 'a',
					name: null,
					role: 'owner',
					...user
				} as SessionUser)
			: undefined
	} as App.Locals;
}

describe('requireOwner', () => {
	it('lets the owner through', () => {
		expect(requireOwner(locals()).id).toBe('user-a');
	});

	it('refuses a manager with 403 and the German sentence', () => {
		expect(() => requireOwner(locals({ role: 'manager' }))).toThrow(
			expect.objectContaining({
				status: 403,
				body: expect.objectContaining({
					message: 'Das darf nur der Vermieter des Kontos.'
				})
			})
		);
	});

	it('sends a signed-out visitor to the sign-in page', () => {
		expect(() => requireOwner(locals(null))).toThrow(
			expect.objectContaining({ status: 303, location: '/anmelden' })
		);
	});
});

describe('requireUser, requireAccount and auditContext', () => {
	it('return the signed-in user, for managers too', () => {
		const manager = locals({ id: 'user-m', role: 'manager' });
		expect(requireUser(manager).id).toBe('user-m');
		expect(requireAccount(manager)).toBe('a');
		expect(auditContext(manager)).toEqual({ accountId: 'a', userId: 'user-m' });
		expect(() => requireAccount(locals(null))).toThrow(
			expect.objectContaining({ status: 303, location: '/anmelden' })
		);
	});
});
