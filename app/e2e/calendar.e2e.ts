import { expect, request, test } from '@playwright/test';

// The calendar link: created under Einstellungen, then fetched without a session the way a
// calendar app does, and revoked again.

test('creates a calendar link that works without signing in, and revokes it', async ({
	page,
	baseURL
}) => {
	await page.goto('/einstellungen/kalender');
	await expect(page.getByRole('heading', { level: 1, name: 'Kalender' })).toBeVisible();
	await page.getByRole('button', { name: /Link erstellen/ }).click();
	const link = await page.getByLabel('Kalender-Link').inputValue();
	expect(link).toMatch(/\/api\/calendar\/[\w-]+\.ics$/);

	const anonymous = await request.newContext({ baseURL, storageState: undefined });
	const feed = await anonymous.get(new URL(link).pathname);
	expect(feed.status()).toBe(200);
	expect(feed.headers()['content-type']).toBe('text/calendar; charset=utf-8');
	expect(await feed.text()).toContain('BEGIN:VCALENDAR');

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Link widerrufen' }).click();
	await expect(page.getByText('Der Kalender-Link wurde widerrufen.')).toBeVisible();
	expect((await anonymous.get(new URL(link).pathname)).status()).toBe(404);
	await anonymous.dispose();
});
