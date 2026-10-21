import { describe, expect, it } from 'vitest';
import { returnPath } from './return-path';

describe('returnPath', () => {
	it('keeps paths of the app with their query', () => {
		expect(returnPath('/vertraege/neu')).toBe('/vertraege/neu');
		expect(returnPath('/vertraege/neu?unitId=u1')).toBe('/vertraege/neu?unitId=u1');
	});

	it('refuses everything a browser would take to another site', () => {
		// Each of these opens evil.example when used as href or Location.
		expect(returnPath('//evil.example/x')).toBeNull();
		expect(returnPath('/\\evil.example/x')).toBeNull();
		expect(returnPath('/\t/evil.example/x')).toBeNull();
		expect(returnPath('/\n/evil.example/x')).toBeNull();
		expect(returnPath('https://evil.example/x')).toBeNull();
		expect(returnPath('javascript:alert(1)')).toBeNull();
		expect(returnPath('evil.example')).toBeNull();
		expect(returnPath('')).toBeNull();
		expect(returnPath(null)).toBeNull();
		expect(returnPath(undefined)).toBeNull();
	});
});
