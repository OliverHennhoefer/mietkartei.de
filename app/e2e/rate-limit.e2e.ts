import { expect, test, type APIRequestContext } from '@playwright/test';

// Runs after every other project: once the limit is reached, this address cannot sign in for a
// minute, which would break the tests that sign in.
//
// The limit is 10 attempts per address and fixed window. Earlier projects already spent part of
// the budget and a window may end during the test, so the test does not count exactly: it posts
// until the first 429, which within 25 attempts must come whatever the window looks like.

const MAX_ATTEMPTS = 25;

async function attemptsUntilRefused(request: APIRequestContext, baseURL: string) {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const response = await request.post('/anmelden', {
			headers: { origin: baseURL },
			form: { email: 'niemand@example.org', password: 'falsches-passwort' },
			maxRedirects: 0
		});
		if (response.status() === 429) return attempt;
	}
	return null;
}

test('slows down repeated sign-in attempts from one address, signed in or not', async ({
	playwright,
	baseURL
}) => {
	// A session must not skip the count, so the signed-in client alone has to reach the limit.
	const signedIn = await playwright.request.newContext({
		baseURL,
		storageState: '.e2e/owner.json'
	});
	expect(await attemptsUntilRefused(signedIn, baseURL!)).not.toBeNull();
	await signedIn.dispose();

	const signedOut = await playwright.request.newContext({ baseURL });
	expect(await attemptsUntilRefused(signedOut, baseURL!)).not.toBeNull();
	await signedOut.dispose();
});
