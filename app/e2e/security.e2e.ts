import { expect, test } from '@playwright/test';

// Every page must work under the Content-Security-Policy from vite.config.ts: a style attribute
// or an inline script without nonce would be blocked in the browser, not in the build.

const pages = [
	'/objekte',
	'/objekte/neu',
	'/mieter',
	'/mieter/neu',
	'/vertraege',
	'/vertraege/neu',
	'/mietkonto',
	'/bank',
	'/bank/konten',
	'/bank/import',
	'/bank/regeln',
	'/einstellungen',
	'/einstellungen/profil',
	'/einstellungen/vpi'
];

test('no page violates the Content-Security-Policy', async ({ page }) => {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
	});
	for (const path of pages) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	}
	expect(violations).toEqual([]);
});

test('pages of a signed-in user are not cached', async ({ request }) => {
	const response = await request.get('/objekte');
	expect(response.headers()['cache-control']).toBe('private, no-store');
});
