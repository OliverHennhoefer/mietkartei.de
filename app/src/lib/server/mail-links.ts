// The links in mails (password reset, invitation, address confirmation) carry a token that signs
// someone in, and the mail goes to someone other than the sender of the request.

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The origin for the link in a mail, or undefined when the request cannot be trusted with it.
 * The link must not follow a Host header the sender chose: ORIGIN wins when set; on Workers the
 * request URL is the host Cloudflare routed to the app; on node without ORIGIN the Host header is
 * the client's, and only a loopback address is accepted, because a link to localhost cannot lead
 * to a foreign site.
 */
export function mailLinkOrigin(
	url: URL,
	configuredOrigin: string,
	target: 'node' | 'cloudflare'
): string | undefined {
	if (configuredOrigin) return new URL(configuredOrigin).origin;
	if (target === 'cloudflare' || isLoopback(url.hostname)) return url.origin;
	return undefined;
}

/** The answer when mailLinkOrigin gives none; the operator is told in the log. */
export const MAIL_LINKS_UNAVAILABLE =
	'Links per E-Mail sind hier noch nicht eingerichtet: Wer mietkartei betreibt, muss dafür ORIGIN auf die öffentliche Adresse setzen.';
