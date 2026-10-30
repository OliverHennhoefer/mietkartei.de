import { TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY } from '$app/env/private';

// Cloudflare Turnstile on the registration form and the demo's start: the widget in the browser
// hands the form a token, which the server checks with Cloudflare before it creates the account.
// Without both keys the check is off, e.g. on self-hosted instances, whose registration is closed
// after the first user anyway.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The field the widget adds to the form. */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

/** The site key for the widget, or null when the check is off. */
export function turnstileSiteKey(): string | null {
	return TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY ? TURNSTILE_SITE_KEY : null;
}

/**
 * Whether Cloudflare confirms the token. A missing token, a refusal and an unreachable service all
 * count as failed, so an outage keeps bots out at the cost of new registrations and demos for its
 * duration.
 */
export async function verifyTurnstile(
	token: FormDataEntryValue | null,
	remoteIp: string,
	secret: string = TURNSTILE_SECRET_KEY,
	fetcher: typeof fetch = fetch
): Promise<boolean> {
	if (typeof token !== 'string' || !token || token.length > 2048) return false;
	try {
		const response = await fetcher(VERIFY_URL, {
			method: 'POST',
			body: new URLSearchParams({ secret, response: token, remoteip: remoteIp })
		});
		if (!response.ok) return false;
		const result = (await response.json()) as { success?: unknown };
		return result.success === true;
	} catch {
		return false;
	}
}
