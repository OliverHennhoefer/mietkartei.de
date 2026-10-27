import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_URL } from './legal';

describe('PRIVACY_POLICY_URL', () => {
	it('links the privacy policy of the website on the hosted variant', () => {
		expect(PRIVACY_POLICY_URL).toBe('https://mietkartei.de/datenschutz/');
	});
});
