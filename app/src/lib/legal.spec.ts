import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_URL, PROCESSING_AGREEMENT_URL } from './legal';

describe('legal links', () => {
	it('links no privacy policy or processing agreement on a self-hosted instance', () => {
		expect(PRIVACY_POLICY_URL).toBeNull();
		expect(PROCESSING_AGREEMENT_URL).toBeNull();
	});
});
