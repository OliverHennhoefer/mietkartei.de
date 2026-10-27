import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_URL } from './legal';

describe('PRIVACY_POLICY_URL', () => {
	it('links no privacy policy on a self-hosted instance', () => {
		expect(PRIVACY_POLICY_URL).toBeNull();
	});
});
