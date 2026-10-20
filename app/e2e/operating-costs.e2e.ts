import { expect, test, type Page } from '@playwright/test';
import { seedLease } from './seed';

// The operating costs setup: categories and keys under /betriebskosten, circles and meters on the
// property's tabs, cost items with a receipt. The lease (property, unit, tenant) is seeded; the
// test drives only the pages of this feature.

const suffix = Math.random().toString(36).slice(2, 8);

/** ConfirmButton asks with window.confirm; every dialog of the test is accepted. */
function acceptDialogs(page: Page) {
	page.on('dialog', (dialog) => dialog.accept());
}

test('sets up categories, keys, circles, meters and a cost item with a receipt', async ({
	page
}) => {
	acceptDialogs(page);
	const unitName = `Wohnung EG ${suffix}`;
	const { propertyId } = await seedLease(page.request, {
		property: { name: `Betriebskostenhaus ${suffix}` },
		unit: { name: unitName }
	});

	// Categories: the BetrKV list is seeded on first use.
	await page.goto('/betriebskosten/kostenarten');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betriebskosten');
	await expect(page).toHaveTitle('Betriebskosten · mietkartei');
	const categories = page.getByRole('table', { name: 'Kostenarten' });
	await expect(categories).toContainText('Grundsteuer');
	await expect(categories).toContainText('Hauswart');
	await expect(categories).toContainText('Verwaltungskosten (nicht umlagefähig)');
	await expect(categories.getByRole('row').filter({ hasText: 'Heizung' }).first()).toContainText(
		'Heizung 70/30'
	);

	// A custom key for the property, with a share for its unit.
	await page.goto('/betriebskosten/schluessel');
	const keys = page.getByRole('table', { name: 'Umlageschlüssel' });
	await expect(keys).toContainText('Wohnfläche');
	await expect(keys).toContainText('Beträge je Einheit');
	const keyName = `Miteigentumsanteile ${suffix}`;
	await page.getByLabel('Bezeichnung').fill(keyName);
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('custom');
	await page
		.getByRole('combobox', { name: 'Objekt' })
		.selectOption({ label: `Betriebskostenhaus ${suffix}` });
	await page.getByRole('button', { name: 'Umlageschlüssel anlegen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/schluessel\/[0-9a-f-]+$/);
	await expect(page.getByRole('heading', { level: 2, name: keyName })).toBeVisible();
	await page.getByLabel(unitName).fill('500');
	await page.getByRole('button', { name: 'Anteile speichern' }).click();
	await expect(page.getByText('Die Anteile wurden gespeichert.')).toBeVisible();
	await expect(page.getByLabel(unitName)).toHaveValue('500');

	// A billing circle on the property's tab.
	await page.goto(`/objekte/${propertyId}/abrechnungskreise`);
	await expect(page.getByText('Dieses Objekt hat noch keine Abrechnungskreise.')).toBeVisible();
	const circleName = `Haus A ${suffix}`;
	await page.getByLabel('Bezeichnung').fill(circleName);
	await page.getByLabel(unitName).check();
	await page.getByRole('button', { name: 'Abrechnungskreis anlegen' }).click();
	const circles = page.getByRole('list', { name: 'Abrechnungskreise' });
	await expect(circles.getByRole('listitem')).toHaveCount(1);
	await expect(circles).toContainText(circleName);
	await expect(circles).toContainText(unitName);

	// A heat meter of the unit with two readings; a second reading on the same date is refused.
	await page.goto(`/objekte/${propertyId}/zaehler`);
	await expect(page.getByText('Dieses Objekt hat noch keine Zähler.')).toBeVisible();
	await page
		.getByRole('combobox', { name: 'Einheit', exact: true })
		.selectOption({ label: unitName });
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('heat');
	await expect(page.getByLabel('Einheit der Messung')).toHaveValue('kWh');
	await page.getByLabel('Zählernummer (optional)').fill(`WMZ-${suffix}`);
	await page.getByLabel('Standort (optional)').fill('Flur');
	await page.getByLabel('Eingebaut am (optional)').fill('2024-12-01');
	await page.getByRole('button', { name: 'Zähler anlegen' }).click();
	await expect(page).toHaveURL(/\/zaehler\?meter=[0-9a-f-]+$/);
	const meters = page.getByRole('table', { name: `Zähler ${unitName}` });
	await expect(meters).toContainText('Wärme');
	await expect(meters).toContainText(`WMZ-${suffix}`);
	await expect(meters).toContainText('noch kein Stand');

	const readings = page.getByRole('region', { name: 'Zählerstände' });
	await expect(readings).toContainText('Noch kein Zählerstand erfasst.');
	await readings.getByLabel('Abgelesen am').fill('2025-01-01');
	await readings.getByLabel('Stand in kWh').fill('1000');
	await readings.getByRole('button', { name: 'Zählerstand erfassen' }).click();
	await expect(readings.getByRole('table')).toContainText('01.01.2025');
	await readings.getByLabel('Abgelesen am').fill('2025-12-31');
	await readings.getByLabel('Stand in kWh').fill('2.500,5');
	await readings.getByLabel('geschätzt (§ 9a HeizKV)').check();
	await readings.getByRole('button', { name: 'Zählerstand erfassen' }).click();
	const readingRows = readings.getByRole('table').getByRole('row');
	await expect(readingRows).toHaveCount(3);
	await expect(readingRows.nth(1)).toContainText('31.12.2025');
	await expect(readingRows.nth(1)).toContainText('2.500,5');
	await expect(readingRows.nth(1)).toContainText('geschätzt');
	await expect(meters).toContainText('2.500,5 kWh am 31.12.2025');
	await readings.getByLabel('Abgelesen am').fill('2025-12-31');
	await readings.getByLabel('Stand in kWh').fill('2600');
	await readings.getByRole('button', { name: 'Zählerstand erfassen' }).click();
	await expect(page.getByText('Für dieses Datum gibt es schon einen Zählerstand.')).toBeVisible();

	// A cost item with a receipt file, prefilled with the property and the year.
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=2025`);
	await expect(page.getByRole('combobox', { name: 'Objekt', exact: true })).toHaveValue(propertyId);
	await expect(page.getByLabel('Zeitraum von')).toHaveValue('2025-01-01');
	await expect(page.getByLabel('Zeitraum bis')).toHaveValue('2025-12-31');
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: '1 Grundsteuer' });
	await page.getByRole('combobox', { name: 'Abrechnungskreis' }).selectOption({
		label: `Betriebskostenhaus ${suffix} – ${circleName}`
	});
	const description = `Grundsteuer 2025 ${suffix}`;
	await page.getByLabel('Beschreibung').fill(description);
	await page.getByLabel('Lieferant (optional)').fill('Stadt Berlin');
	await page.getByLabel('Rechnungsdatum').fill('2025-02-15');
	await page.getByLabel('Betrag in €').fill('1.200,00');
	await page.getByLabel('Beleg als Datei (optional, höchstens 10 MB)').setInputFiles({
		name: 'grundsteuer.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Grundsteuerbescheid 2025: 1.200,00 €')
	});
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/[0-9a-f-]+$/);
	const itemUrl = page.url();
	await expect(page.getByRole('heading', { level: 2, name: description })).toBeVisible();
	const details = page.locator('dl.details');
	await expect(details).toContainText('Grundsteuer');
	await expect(details).toContainText('Wohnfläche');
	await expect(details).toContainText(circleName);
	await expect(details).toContainText('1.200,00 €');
	await expect(page.getByRole('link', { name: 'grundsteuer.txt' })).toHaveAttribute(
		'href',
		/\/dokumente\/[0-9a-f-]+\/download$/
	);

	// The list, filtered by the property and the year, with the sum per category.
	await page.goto(`/betriebskosten/belege?property=${propertyId}&year=2025`);
	const items = page.getByRole('table', { name: 'Belege' });
	await expect(items.getByRole('row').filter({ hasText: description })).toContainText('15.02.2025');
	await expect(items).toContainText('Stadt Berlin');
	await expect(items).toContainText('grundsteuer.txt');
	const totals = page.getByRole('table', { name: 'Summe je Kostenart' });
	await expect(totals.getByRole('row').filter({ hasText: 'Grundsteuer' })).toContainText(
		'1.200,00 €'
	);

	// Delete the item from its page; the receipt goes with it.
	await page.getByRole('link', { name: description }).click();
	await expect(page).toHaveURL(itemUrl);
	await page.getByRole('button', { name: 'Beleg löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\?property=.*&year=2025$/);
	await expect(page.getByText('Für 2025 sind noch keine Belege erfasst.')).toBeVisible();
});

test('answers an unknown cost item with 404', async ({ page }) => {
	const response = await page.goto('/betriebskosten/belege/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
