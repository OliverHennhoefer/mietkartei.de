import { describe, expect, it } from 'vitest';
import { PRIVACY_POLICY_URL, PROCESSING_AGREEMENT_URL } from './legal';

describe('legal links', () => {
	it('links the privacy policy and the processing agreement of the website on the hosted variant', () => {
		expect(PRIVACY_POLICY_URL).toBe('https://mietkartei.de/datenschutz/');
		expect(PROCESSING_AGREEMENT_URL).toBe('https://mietkartei.de/auftragsverarbeitung/');
	});
});
