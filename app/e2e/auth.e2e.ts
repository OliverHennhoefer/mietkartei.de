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

test('closes registration after the first user on a self-hosted instance', async ({ page }) => {
	await page.goto('/registrieren');
	await expect(
		page.getByText('Auf dieser Instanz können sich keine weiteren Personen registrieren.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Konto anlegen' })).toHaveCount(0);
});
