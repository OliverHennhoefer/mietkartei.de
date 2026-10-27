// The privacy policy and the data processing agreement of the hosted variant, on the website. A
// self-hosted instance is run by someone else, who writes their own, so it links neither.
const hosted = __DEPLOY_TARGET__ === 'cloudflare';

export const PRIVACY_POLICY_URL = hosted ? 'https://mietkartei.de/datenschutz/' : null;

export const PROCESSING_AGREEMENT_URL = hosted
	? 'https://mietkartei.de/auftragsverarbeitung/'
	: null;
