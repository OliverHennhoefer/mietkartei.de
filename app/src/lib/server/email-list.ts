// The address lists of the secrets REGISTRATION_EMAILS, FREE_ACCOUNT_EMAILS and BANK_SYNC_EMAILS. All
// are typed by hand into the Cloudflare dashboard or `wrangler secret put`, so all accept the same
// separators.

/** The addresses of a list separated by commas, semicolons or whitespace, in lower case. */
export function parseEmailList(value: string): string[] {
	return value
		.split(/[\s,;]+/)
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
}
