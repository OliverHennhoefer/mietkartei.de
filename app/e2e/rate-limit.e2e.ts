import { expect, test, type APIRequestContext } from '@playwright/test';

// The project has a client address of its own (playwright.config.ts), sent in extraHTTPHeaders.
//
// The limit is 10 attempts per address and fixed window. A window may end during the test, so
// the test does not count exactly: it posts until the first 429, which within 25 attempts must
// come whatever the window looks like.

const MAX_ATTEMPTS = 25;

async function attemptsUntilRefused(
	request: APIRequestContext,
	baseURL: string,
	path = '/anmelden',
	form: Record<string, string> = { email: 'niemand@example.org', password: 'falsches-passwort' }
) {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const response = await request.post(path, {
			headers: { origin: baseURL },
			form,
			maxRedirects: 0
		});
		if (response.status() === 429) return attempt;
	}
	return null;
}

test('slows down repeated sign-in attempts from one address, signed in or not', async ({
	playwright,
	baseURL,
	extraHTTPHeaders
}) => {
	// A session must not skip the count, so the signed-in client alone has to reach the limit.
	const signedIn = await playwright.request.newContext({
		baseURL,
		extraHTTPHeaders,
		storageState: '.e2e/owner.json'
	});
	expect(await attemptsUntilRefused(signedIn, baseURL!)).not.toBeNull();
	await signedIn.dispose();

	const signedOut = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
	expect(await attemptsUntilRefused(signedOut, baseURL!)).not.toBeNull();
	await signedOut.dispose();
});

test('slows down repeated attempts to delete the account', async ({
	playwright,
	baseURL,
	extraHTTPHeaders
}) => {
	// The deletion checks the password as well. Posted without one, so the owner's failed
	// sign-ins do not grow and the account project can still delete the account.
	const signedIn = await playwright.request.newContext({
		baseURL,
		extraHTTPHeaders,
		storageState: '.e2e/owner.json'
	});
	expect(
		await attemptsUntilRefused(signedIn, baseURL!, '/einstellungen/konto?/delete', {
			password: ''
		})
	).not.toBeNull();
	await signedIn.dispose();
});
