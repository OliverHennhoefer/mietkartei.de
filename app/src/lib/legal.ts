// The privacy policy of the hosted variant, on the website. A self-hosted instance is run by
// someone else, who writes their own, so it links none.
export const PRIVACY_POLICY_URL =
	__DEPLOY_TARGET__ === 'cloudflare' ? 'https://mietkartei.de/datenschutz/' : null;
