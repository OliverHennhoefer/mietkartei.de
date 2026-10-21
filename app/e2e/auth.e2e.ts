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

// The hosted variant lets only the addresses of REGISTRATION_EMAILS register (playwright.config.ts
// lists the owner); a self-hosted instance only its first person.
const hosted = process.env.DEPLOY_TARGET === 'cloudflare';

test('closes registration after the first user on a self-hosted instance', async ({ page }) => {
	test.skip(hosted, 'The hosted variant registers listed addresses only.');
	await page.goto('/registrieren');
	await expect(
		page.getByText('Auf dieser Instanz können sich keine weiteren Personen registrieren.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Konto anlegen' })).toHaveCount(0);
});

test('refuses an address that is not listed on the hosted variant', async ({ page }) => {
	test.skip(!hosted, 'Self-hosted instances have no list.');
	await page.goto('/registrieren');
	await expect(page.getByText('mietkartei ist noch nicht öffentlich.')).toBeVisible();
	await page.getByLabel('E-Mail-Adresse').fill('fremd@example.org');
	await page.getByLabel('Passwort').fill('noch-ein-sicheres-passwort');
	await page.getByRole('button', { name: 'Konto anlegen' }).click();

	await expect(
		page.getByText('Diese E-Mail-Adresse ist nicht für eine Registrierung freigeschaltet.')
	).toBeVisible();
	await expect(page).toHaveURL(/\/registrieren$/);
});

test('offers no registration link on the sign-in page', async ({ page }) => {
	await page.goto('/anmelden');
	await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCount(0);
});

test('sends the security headers and a CSP with a nonce', async ({ request }) => {
	const response = await request.get('/anmelden');
	const headers = response.headers();
	const csp = headers['content-security-policy'];
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("form-action 'self'");
	expect(csp).toMatch(/script-src 'self'[^;]* 'nonce-[^']+'/);
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('same-origin');
	expect(headers['x-content-type-options']).toBe('nosniff');
});
