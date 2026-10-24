import { describe, expect, it } from 'vitest';
import { viewerWritesOn } from './viewer-paths';

describe('viewerWritesOn', () => {
	it('names the pages whose forms viewers may submit', () => {
		expect(viewerWritesOn('/e-mail-bestaetigen/token')).toBe(true);
		expect(viewerWritesOn('/passwort-zuruecksetzen/token')).toBe(true);
		expect(viewerWritesOn('/einstellungen/profil/')).toBe(true);
		expect(viewerWritesOn('/einstellungen/kalender')).toBe(true);
		expect(viewerWritesOn('/objekte')).toBe(false);
		expect(viewerWritesOn('/betriebskosten/schluessel/x')).toBe(false);
	});
});
