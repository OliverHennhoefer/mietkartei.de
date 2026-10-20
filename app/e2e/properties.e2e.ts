import { expect, test } from '@playwright/test';

test('creates a property and adds units to it', async ({ page }) => {
	await page.goto('/objekte');
	await expect(page.getByRole('heading', { level: 1, name: 'Objekte' })).toBeVisible();

	await page.getByLabel('Bezeichnung').fill('Mehrfamilienhaus Lindenstraße');
	await page.getByLabel('Straße und Hausnummer').fill('Lindenstraße 4');
	await page.getByLabel('Postleitzahl').fill('10115');
	await page.getByLabel('Ort').fill('Berlin');
	await page.getByRole('button', { name: 'Objekt anlegen' }).click();

	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mehrfamilienhaus Lindenstraße');
	await expect(page.getByText('Dieses Objekt hat noch keine Einheiten.')).toBeVisible();

	await page.getByLabel('Bezeichnung').fill('Wohnung EG links');
	await page.getByLabel('Art').selectOption({ label: 'Wohnung' });
	await page.getByLabel('Fläche in m² (optional)').fill('72,5');
	await page.getByRole('button', { name: 'Einheit anlegen' }).click();

	const units = page.getByRole('list', { name: 'Einheiten' });
	await expect(units.getByRole('listitem')).toHaveCount(1);
	await expect(units).toContainText('Wohnung EG links');
	await expect(units).toContainText('72,5 m²');

	await page.getByRole('link', { name: '← Alle Objekte' }).click();
	await expect(page.getByRole('list', { name: 'Objekte' })).toContainText(
		'Mehrfamilienhaus Lindenstraße'
	);
});

test('shows validation errors next to the fields', async ({ page }) => {
	await page.goto('/objekte');
	await page.getByLabel('Bezeichnung').fill('Haus ohne Postleitzahl');
	await page.getByLabel('Straße und Hausnummer').fill('Am Markt 1');
	await page.getByLabel('Postleitzahl').fill('123');
	await page.getByLabel('Ort').fill('Leipzig');
	await page.getByRole('button', { name: 'Objekt anlegen' }).click();

	await expect(page.getByText('Die Postleitzahl hat fünf Ziffern.')).toBeVisible();
	await expect(page.getByLabel('Bezeichnung')).toHaveValue('Haus ohne Postleitzahl');
});

test('answers unknown properties with 404', async ({ page }) => {
	const response = await page.goto('/objekte/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
