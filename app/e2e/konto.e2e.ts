import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { owner } from './owner';
import { FAKE_SUBSCRIPTION_ID, requests, start, stop } from './stripe-fake';
import { clearTables, seedRows } from './seed';

// Project "account", runs last with the owner's storage state: the export, then the deletion
// of the account, after which nothing else can run. The owner's subscription (sub_fake, started
// in billing.e2e.ts) runs, so the deletion has to cancel it at the Stripe fake first.

test.afterAll(async () => {
	await stop();
});

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
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();

	await page.goto('/einstellungen/konto');
	await expect(page.getByText('Dein Abo wird dabei sofort gekündigt')).toBeVisible();
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page.getByText('Das Passwort stimmt nicht.')).toBeVisible();

	// While Stripe does not answer (the fake is not running), the subscription cannot be
	// canceled, so the account stays.
	await stop();
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'Stripe antwortet gerade nicht' })
	).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);

	await start();
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page).toHaveURL(/\/registrieren$/);
	const cancel = requests.filter(
		(entry) => entry.path === `/v1/subscriptions/${FAKE_SUBSCRIPTION_ID}`
	);
	expect(cancel.map((entry) => entry.method)).toEqual(['DELETE']);

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

	// The first-run checklist shows instead of the tiles, each step linked to its create page.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Kennzahlen' })).toHaveCount(0);
	const steps = page.locator('.first-run ol > li');
	await expect(steps.getByRole('link')).toHaveText([
		'Objekt anlegen',
		'Einheit anlegen',
		'Mieter anlegen',
		'Mietvertrag mit Miete und Kaution anlegen',
		'Bankverbindung für den Umsatzabgleich anlegen',
		'Kostenarten und Umlageschlüssel prüfen'
	]);
	await expect(steps.nth(0).getByRole('link')).toHaveAttribute('href', '/objekte/neu');
	await expect(steps.nth(5).getByRole('link')).toHaveAttribute(
		'href',
		'/betriebskosten/kostenarten'
	);

	// With a property but no lease and no bank account it stays, the property ticked off and the
	// unit step pointing to the property's page with the unit form.
	const {
		ids: [propertyId]
	} = await seedRows(page.request, 'properties', [
		{ name: 'Erstes Haus', street: 'Anfangsweg 1', postalCode: '10115', city: 'Berlin' }
	]);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Kennzahlen' })).toHaveCount(0);
	await expect(steps.nth(0)).toContainText('erledigt');
	await expect(steps.nth(1)).not.toContainText('erledigt');
	await expect(steps.nth(1).getByRole('link')).toHaveAttribute('href', `/objekte/${propertyId}`);
	// Demo data only goes into an account without any property.
	await expect(page.getByRole('link', { name: 'Demodaten' })).toHaveCount(0);
	await clearTables(page.request, ['properties']);

	await page.goto('/');
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
