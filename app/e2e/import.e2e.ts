import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { monthOf, monthsInRange, today } from '../src/lib/dates';
import { formatCents } from '../src/lib/money';
import { watchCspViolations } from './csp';

// The CSV import: four files in the order a landlord migrates (properties and units, tenants,
// leases, payments), each through mapping, preview and commit on /datenuebernahme. The fixtures carry
// names no other test uses, and every run starts from a fresh database.

function fixture(name: string): string {
	return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

async function preview(page: Page, kind: string, file: string) {
	await page.goto('/einstellungen');
	await page
		.getByRole('navigation', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Datenübernahme' })
		.click();
	await expect(page).toHaveURL(/\/datenuebernahme$/);
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
	// The mapping, the preview and the summary are only reached by posting, so the CSP is
	// checked here and not only in security.e2e.ts.
	const violations = watchCspViolations(page);
	await page.goto('/einstellungen');
	await page
		.getByRole('navigation', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Datenübernahme' })
		.click();
	await expect(page).toHaveURL(/\/datenuebernahme$/);

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

	await test.step('the imported lease books from its ledger start', async () => {
		// The lease runs since 01.03.2024 but its Mietkonto starts 01.01.2026 with an opening
		// balance of 150,00 € owed; from January 2026 on every month adds 650 € + 150 € + 50 €
		// = 850 €, and the imported payment of 850 € on 05.01.2026 pays one of them. So the
		// balance is 150 € + 850 € × (months from January 2026 up to now) − 850 €.
		const months = monthsInRange('2026-01', monthOf(today())).length;
		const balance = 15000 + 85000 * months - 85000;
		await page.goto('/mietkonto');
		await page
			.getByRole('table', { name: 'Salden' })
			.locator('tr', { hasText: 'Importmann' })
			.getByRole('link', { name: 'Mietkonto' })
			.click();
		await expect(page).toHaveURL(/\/vertraege\/[\w-]+\/mietkonto$/);
		await page.goto(`${page.url()}?from=2025-12&to=2026-01`);
		await expect(page.locator('.balance strong')).toHaveText(
			`Saldo: Rückstand ${formatCents(balance)}`
		);
		const rows = page.getByRole('table', { name: 'Buchungen' }).locator('tbody tr');
		// Nothing before the ledger start: the opening balance, January's rent and the payment.
		await expect(rows).toHaveCount(3);
		await expect(rows.filter({ hasText: 'Dezember 2025' })).toHaveCount(0);
		const opening = rows.filter({ hasText: 'Anfangssaldo' });
		await expect(opening).toContainText('01.01.2026');
		await expect(opening.locator('td').nth(2)).toHaveText(formatCents(15000));
		await expect(rows.filter({ hasText: 'Miete Januar 2026' }).locator('td').nth(2)).toHaveText(
			formatCents(85000)
		);
		const payment = rows.filter({ hasText: '05.01.2026' }).filter({ hasNotText: 'Januar 2026' });
		await expect(payment.locator('td').nth(3)).toHaveText(formatCents(85000));
		// After the three lines January is paid; the opening balance is what is left.
		await expect(rows.nth(2).locator('td').nth(4)).toHaveText(formatCents(15000));
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
	expect(violations).toEqual([]);
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

	// The refused commit re-renders the mapping form with the same refusal, so wait for its
	// response before touching the selects: otherwise the re-render would discard the choices.
	await Promise.all([
		page.waitForResponse((response) => response.request().method() === 'POST'),
		page.getByRole('button', { name: 'Importieren' }).click()
	]);
	await expect(refusal).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Spalten zuordnen' })).toBeVisible();

	// Mapping the columns by hand makes the rows importable. The preview is requested anew so the
	// selects are the ones rendered after the refusal.
	await preview(page, 'Mieter', 'import-falsch.csv');
	await mapping(page, 'firstName').selectOption('0');
	await mapping(page, 'lastName').selectOption('1');
	await page.getByRole('button', { name: 'Vorschau aktualisieren' }).click();
	await expect(previewRows(page).nth(0)).toContainText('ok');
	await commit(page, '1 Mieter angelegt');
});

test('answers unknown pages under /datenuebernahme with 404', async ({ page }) => {
	const response = await page.goto('/datenuebernahme/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
