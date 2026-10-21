import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { owner } from './owner';

// Project "account", runs last with the owner's storage state: the export, then the deletion
// of the account, after which nothing else can run.

test('downloads the export as a ZIP with export.json and a documents folder', async ({ page }) => {
	await page.goto('/einstellungen/export');
	await expect(page.getByRole('button', { name: 'Export herunterladen' })).toBeVisible();

	const response = await page.request.get('/einstellungen/export/download');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/zip');
	expect(response.headers()['content-disposition']).toMatch(
		/^attachment; filename="mietkartei-export-/
	);

	const files = unzipSync(new Uint8Array(await response.body()));
	const names = Object.keys(files);
	expect(names).toContain('export.json');
	expect(names.some((name) => name.startsWith('documents/'))).toBe(true);
	const data = JSON.parse(strFromU8(files['export.json'])) as {
		format: string;
		tables: Record<string, Record<string, unknown>[]>;
	};
	expect(data.format).toBe('mietkartei');
	expect(data.tables.accounts).toHaveLength(1);
	expect(data.tables.users.some((user) => user.email === owner.email)).toBe(true);
	expect(data.tables.users.every((user) => !('passwordHash' in user))).toBe(true);
	expect(data.tables.properties).toBeDefined();

	await page.goto('/einstellungen/protokoll?entity=account');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Alle Daten als ZIP-Datei exportiert'
	);
});

test('deletes the account after the password is entered again', async ({ page, baseURL }) => {
	await page.goto('/einstellungen/konto');
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page.getByText('Das Passwort stimmt nicht.')).toBeVisible();

	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page).toHaveURL(/\/registrieren$/);

	// The owner was the last user, so the instance is empty again: the sign-in page sends every
	// visitor to the registration, and the old credentials do not sign anyone in. The action is
	// posted the way use:enhance does, so its answer is readable without the page's redirect.
	await page.goto('/anmelden');
	await expect(page).toHaveURL(/\/registrieren$/);
	const response = await page.request.post('/anmelden', {
		form: { email: owner.email, password: owner.password },
		headers: { origin: baseURL!, 'x-sveltekit-action': 'true' }
	});
	expect(response.status()).toBe(400);
	expect((await response.json()) as { type: string }).toMatchObject({ type: 'failure' });
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/(anmelden|registrieren)$/);
});

test('fills a fresh account with demo data from the account page', async ({ page }) => {
	// After the deletion above the instance is empty: register again, then load the demo.
	await page.context().clearCookies();
	await page.goto('/registrieren');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto anlegen' }).click();
	await expect(page).not.toHaveURL(/\/registrieren$/);

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toBeVisible();
	await page.getByRole('link', { name: 'Demodaten' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);
	await page.getByRole('button', { name: 'Demodaten anlegen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toHaveCount(0);
	const tiles = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(tiles.nth(0).locator('.value')).not.toHaveText('0,00 €');
	await expect(tiles.nth(2).locator('.value')).toHaveText('3');

	await page.goto('/objekte');
	await expect(page.getByText('Lindenstraße 12').first()).toBeVisible();
	await expect(page.getByText('Gartenweg 3').first()).toBeVisible();

	// The button is gone once the account holds data.
	await page.goto('/einstellungen/konto');
	await expect(page.getByRole('button', { name: 'Demodaten anlegen' })).toHaveCount(0);
});
