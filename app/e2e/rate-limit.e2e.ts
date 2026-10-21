import { expect, test } from '@playwright/test';

// Runs after every other project: once the limit is reached, this address cannot sign in for a
// minute, which would break the tests that sign in.

test('slows down repeated sign-in attempts from one address', async ({ request, baseURL }) => {
	const statuses: number[] = [];
	for (let attempt = 0; attempt < 12; attempt++) {
		const response = await request.post('/anmelden', {
			headers: { origin: baseURL! },
			form: { email: 'niemand@example.org', password: 'falsches-passwort' }
		});
		statuses.push(response.status());
	}
	expect(statuses.slice(0, 5)).not.toContain(429);
	expect(statuses.at(-1)).toBe(429);
});
