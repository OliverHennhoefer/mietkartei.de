import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The CSV import: four files in the order a landlord migrates (properties and units, tenants,
// leases, payments), each through mapping, preview and commit on /import. The fixtures carry
// names no other test uses, and every run starts from a fresh database.

function fixture(name: string): string {
	return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

async function preview(page: Page, kind: string, file: string) {
	await page.goto('/import');
	await expect(page.getByRole('heading', { level: 1, name: 'Datenübernahme' })).toBeVisible();
	await page.getByLabel('Art der Daten').selectOption({ label: kind });
	await page.getByLabel('CSV-Datei').setInputFiles(fixture(file));
	await page.getByRole('button', { name: 'Vorschau anzeigen' }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Spalten zuordnen' })).toBeVisible();
}

function mapping(page: Page, field: string) {
	return page.locator(`select[name="map.${field}"]`);
}

function previewRows(page: Page) {
	return page.getByRole('table', { name: 'Vorschau' }).locator('tbody tr');
}

async function commit(page: Page, expected: string) {
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'angelegt' })).toContainText(expected);
}

test('imports properties, tenants, leases and payments from CSV files in order', async ({
	page
}) => {
	await test.step('properties and units', async () => {
		await preview(page, 'Objekte und Einheiten', 'import-objekte.csv');
		await expect(mapping(page, 'propertyName')).toHaveValue('0');
		await expect(mapping(page, 'street')).toHaveValue('1');
		await expect(mapping(page, 'unitName')).toHaveValue('4');
		await expect(mapping(page, 'floorArea')).toHaveValue('6');
		await expect(previewRows(page)).toHaveCount(2);
		await expect(previewRows(page).nth(0)).toContainText('Wohnung EG');
		await expect(previewRows(page).nth(0)).toContainText('ok');
		await expect(page.getByText('2 von 2 Zeilen werden importiert')).toBeVisible();
		await commit(page, '1 Objekt und 2 Einheiten angelegt');
	});

	await test.step('tenants', async () => {
		await preview(page, 'Mieter', 'import-mieter.csv');
		await expect(mapping(page, 'firstName')).toHaveValue('1');
		await expect(mapping(page, 'lastName')).toHaveValue('2');
		await expect(mapping(page, 'email')).toHaveValue('3');
		await expect(previewRows(page)).toHaveCount(2);
		await commit(page, '2 Mieter angelegt');
	});

	await test.step('leases with an opening balance', async () => {
		await preview(page, 'Mietverträge', 'import-vertraege.csv');
		await expect(mapping(page, 'tenantNames')).toHaveValue('2');
		await expect(mapping(page, 'ledgerStart')).toHaveValue('9');
		await expect(mapping(page, 'openingBalance')).toHaveValue('10');
		await expect(previewRows(page)).toHaveCount(1);
		await expect(previewRows(page).nth(0)).toContainText('ok');
		await commit(page, '1 Mietvertrag angelegt');
	});

	await test.step('payments', async () => {
		await preview(page, 'Zahlungen', 'import-zahlungen.csv');
		await expect(mapping(page, 'date')).toHaveValue('0');
		await expect(mapping(page, 'amount')).toHaveValue('3');
		await expect(mapping(page, 'note')).toHaveValue('4');
		await expect(previewRows(page)).toHaveCount(1);
		await expect(previewRows(page).nth(0)).toContainText('ok');
		await commit(page, '1 Zahlung angelegt');
	});

	await test.step('a second import of the same units is skipped as duplicates', async () => {
		await preview(page, 'Objekte und Einheiten', 'import-objekte.csv');
		await expect(previewRows(page).nth(0)).toContainText(
			'Die Einheit „Wohnung EG“ gibt es in „Importhaus Rosenweg“ schon.'
		);
		await expect(page.getByText('0 von 2 Zeilen werden importiert')).toBeVisible();
		await page.getByRole('button', { name: 'Importieren' }).click();
		await expect(
			page.getByText('Keine Zeile der Datei ist gültig; es wurde nichts importiert.')
		).toBeVisible();
	});
});

test('a file whose columns match nothing cannot be imported', async ({ page }) => {
	await preview(page, 'Mieter', 'import-falsch.csv');
	await expect(mapping(page, 'firstName')).toHaveValue('');
	await expect(mapping(page, 'firstName').locator('option:checked')).toHaveText(
		'nicht importieren'
	);
	await expect(mapping(page, 'lastName')).toHaveValue('');
	const refusal = page.getByText(
		'Die Pflichtfelder „Vorname“, „Nachname“ sind keiner Spalte zugeordnet'
	);
	await expect(refusal).toBeVisible();

	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(refusal).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Spalten zuordnen' })).toBeVisible();

	// Mapping the columns by hand makes the rows importable.
	await mapping(page, 'firstName').selectOption('0');
	await mapping(page, 'lastName').selectOption('1');
	await page.getByRole('button', { name: 'Vorschau aktualisieren' }).click();
	await expect(previewRows(page).nth(0)).toContainText('ok');
	await commit(page, '1 Mieter angelegt');
});

test('answers unknown pages under /import with 404', async ({ page }) => {
	const response = await page.goto('/import/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
