// Response headers that keep the browser from doing what the app never needs: being framed by
// another site, leaking URLs as referrer, using powerful device APIs. The Content-Security-Policy
// itself comes from the csp option in vite.config.ts, because SvelteKit adds the nonces.

const BASE_HEADERS: Record<string, string> = {
	// frame-ancestors in the CSP does the same for current browsers.
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	// Links to the password reset, invitation and address confirmation pages carry a token in the
	// path, which must not reach other sites. Not no-referrer: browsers then send `Origin: null` with form posts, and
	// SvelteKit's CSRF check refuses them.
	'Referrer-Policy': 'same-origin',
	'Permissions-Policy':
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin'
};

/** Two years, the value the HSTS preload list asks for. */
const HSTS = 'max-age=63072000; includeSubDomains';

/**
 * Sets the security headers on a response. HSTS only over https: self-hosted instances are often
 * reached over plain http in a private network. Pages of a signed-in user hold personal data, so
 * they are not stored by the browser or a proxy unless the route chose its own caching.
 */
export function applySecurityHeaders(
	headers: Headers,
	options: { https: boolean; signedIn: boolean }
): void {
	for (const [name, value] of Object.entries(BASE_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}
	if (options.https) headers.set('Strict-Transport-Security', HSTS);
	if (options.signedIn && !headers.has('Cache-Control')) {
		headers.set('Cache-Control', 'private, no-store');
	}
}
