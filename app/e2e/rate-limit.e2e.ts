import { expect, test } from '@playwright/test';

// Runs after every other project: once the limit is reached, this address cannot sign in for a
// minute, which would break the tests that sign in.

test('slows down repeated sign-in attempts from one address, signed in or not', async ({
	playwright,
	baseURL
}) => {
	const signedOut = await playwright.request.newContext({ baseURL });
	const signedIn = await playwright.request.newContext({
		baseURL,
		storageState: '.e2e/owner.json'
	});
	const statuses: number[] = [];
	for (let attempt = 0; attempt < 12; attempt++) {
		// The second half carries a session, which must not skip the count.
		const request = attempt < 6 ? signedOut : signedIn;
		const response = await request.post('/anmelden', {
			headers: { origin: baseURL! },
			form: { email: 'niemand@example.org', password: 'falsches-passwort' },
			maxRedirects: 0
		});
		statuses.push(response.status());
	}
	await signedOut.dispose();
	await signedIn.dispose();
	expect(statuses.slice(0, 5)).not.toContain(429);
	expect(statuses.at(-1)).toBe(429);
});
