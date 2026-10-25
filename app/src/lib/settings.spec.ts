import { describe, expect, it } from 'vitest';
import { settingsSectionOf, settingsSections } from './settings.ts';

describe('settingsSections', () => {
	const hrefs = (role: string, billing: boolean) =>
		settingsSections(role, billing).map((section) => section.href);

	it('leaves owner-only sections out for managers', () => {
		expect(hrefs('owner', false)).toContain('/einstellungen/zugaenge');
		expect(hrefs('manager', false)).not.toContain('/einstellungen/zugaenge');
		expect(hrefs('manager', false)).not.toContain('/einstellungen/export');
		expect(hrefs('manager', false)).toContain('/einstellungen/ki-assistenten');
	});

	it('leaves the import out for viewers', () => {
		expect(hrefs('manager', false)).toContain('/einstellungen/datenuebernahme');
		expect(hrefs('viewer', false)).not.toContain('/einstellungen/datenuebernahme');
		expect(hrefs('viewer', false)).toContain('/einstellungen/profil');
	});

	it('shows the subscription only where the instance bills', () => {
		expect(hrefs('owner', true)).toContain('/abo');
		expect(hrefs('owner', false)).not.toContain('/abo');
	});
});

describe('settingsSectionOf', () => {
	it('finds the section of a page and of the pages below it', () => {
		expect(settingsSectionOf('/abo')?.label).toBe('Abo');
		expect(settingsSectionOf('/einstellungen/protokoll')?.label).toBe('Protokoll');
		expect(settingsSectionOf('/einstellungen/export/herunterladen')?.label).toBe('Export');
		expect(settingsSectionOf('/einstellungen/datenuebernahme')?.label).toBe('Datenübernahme');
		expect(settingsSectionOf('/abonnement')).toBeUndefined();
		expect(settingsSectionOf('/objekte')).toBeUndefined();
	});
});
