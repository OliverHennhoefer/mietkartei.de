import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { enforceRole, refusesViewer } from './roles';
import { managerA, routeEvent } from './testing';

describe('refusesViewer', () => {
	it('lets viewers read, but not open the pages that create or edit', () => {
		expect(refusesViewer('GET', '/objekte')).toBe(false);
		expect(refusesViewer('HEAD', '/mietkonto/x')).toBe(false);
		expect(refusesViewer('GET', '/objekte/neu')).toBe(true);
		expect(refusesViewer('GET', '/mieter/x/bearbeiten/')).toBe(true);
	});

	it('refuses writes except their own sign-in, calendar link and API keys', () => {
		expect(refusesViewer('POST', '/objekte/neu')).toBe(true);
		expect(refusesViewer('POST', '/aufgaben', 'create')).toBe(true);
		expect(refusesViewer('POST', '/einstellungen/profil', 'landlord')).toBe(true);
		expect(refusesViewer('POST', '/einstellungen/profil', 'password')).toBe(false);
		expect(refusesViewer('POST', '/einstellungen/profil', 'profile')).toBe(false);
		expect(refusesViewer('POST', '/einstellungen/kalender', 'create')).toBe(false);
		expect(refusesViewer('POST', '/einstellungen/ki-assistenten', 'create')).toBe(false);
		expect(refusesViewer('POST', '/abmelden')).toBe(false);
		expect(refusesViewer('POST', '/passwort-zuruecksetzen/token')).toBe(false);
	});
});

describe('enforceRole', () => {
	it('refuses only viewers', async () => {
		const post = (role: 'owner' | 'manager' | 'viewer') => {
			const event = routeEvent(undefined as never, {
				user: { ...managerA, role },
				url: '/objekte?/delete',
				form: {}
			});
			try {
				enforceRole(event);
				return 'allowed';
			} catch (error) {
				return isHttpError(error, 403) ? 'refused' : error;
			}
		};
		expect(post('owner')).toBe('allowed');
		expect(post('manager')).toBe('allowed');
		expect(post('viewer')).toBe('refused');
	});
});
