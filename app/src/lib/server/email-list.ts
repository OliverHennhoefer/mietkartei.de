// The address lists of the secrets REGISTRATION_EMAILS and FREE_ACCOUNT_EMAILS. Both are typed by
// hand into the Cloudflare dashboard or `wrangler secret put`, so both accept the same separators.

/** The addresses of a list separated by commas, semicolons or whitespace, in lower case. */
export function parseEmailList(value: string): string[] {
	return value
		.split(/[\s,;]+/)
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
}
