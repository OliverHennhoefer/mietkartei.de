import { expect, test } from '@playwright/test';
import { owner } from './owner';

test('health check works without signing in', async ({ request }) => {
	const response = await request.get('/health');
	expect(response.ok()).toBe(true);
	expect(await response.json()).toEqual({ status: 'ok' });
});

test('redirects to the sign-in page when signed out', async ({ page }) => {
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/anmelden$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible();
});

test('rejects a wrong password', async ({ page }) => {
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Anmelden' }).click();

	await expect(page.getByRole('alert')).toHaveText('E-Mail-Adresse oder Passwort stimmen nicht.');
	await expect(page).toHaveURL(/\/anmelden$/);
});

test('signs in and out', async ({ page }) => {
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/objekte$/);

	await page.getByRole('button', { name: 'Abmelden' }).click();
	await expect(page).toHaveURL(/\/anmelden$/);
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/anmelden$/);
});

// wrangler.jsonc opens registration for the hosted variant; self-hosted instances keep it closed.
const openRegistration = process.env.DEPLOY_TARGET === 'cloudflare';

test('closes registration after the first user on a self-hosted instance', async ({ page }) => {
	test.skip(openRegistration, 'The hosted variant has open registration.');
	await page.goto('/registrieren');
	await expect(
		page.getByText('Auf dieser Instanz können sich keine weiteren Personen registrieren.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Konto anlegen' })).toHaveCount(0);
});

test('gives a later user an own, empty account on the hosted variant', async ({ page }) => {
	test.skip(!openRegistration, 'Self-hosted instances have closed registration.');
	await page.goto('/registrieren');
	await page.getByLabel('E-Mail-Adresse').fill('zweite@example.org');
	await page.getByLabel('Passwort').fill('noch-ein-sicheres-passwort');
	await page.getByRole('button', { name: 'Konto anlegen' }).click();

	await expect(page).toHaveURL(/\/objekte$/);
	await expect(page.getByText('Du hast noch keine Objekte angelegt.')).toBeVisible();
});

test('sends the security headers and a CSP with a nonce', async ({ request }) => {
	const response = await request.get('/anmelden');
	const headers = response.headers();
	const csp = headers['content-security-policy'];
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("form-action 'self'");
	expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('same-origin');
	expect(headers['x-content-type-options']).toBe('nosniff');
});
