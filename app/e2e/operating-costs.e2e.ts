import { expect, test, type Page } from '@playwright/test';
import { seedForeignLease, seedLease } from './seed';

// The operating costs setup: categories and keys under /betriebskosten, circles and meters on the
// property's tabs, cost items with a receipt. The lease (property, unit, tenant) is seeded; the
// test drives only the pages of this feature.

const suffix = crypto.randomUUID().slice(0, 6);

/** ConfirmButton asks with window.confirm; every dialog of the test is accepted. */
function acceptDialogs(page: Page) {
	page.on('dialog', (dialog) => dialog.accept());
}

test('sets up categories, keys, circles, meters and a cost item with a receipt', async ({
	page
}) => {
	acceptDialogs(page);
	const unitName = `Wohnung EG ${suffix}`;
	const propertyName = `Betriebskostenhaus ${suffix}`;
	const { propertyId, unitId } = await seedLease(page.request, {
		property: { name: propertyName },
		unit: { name: unitName }
	});

	// The first tab lists the statements; the BetrKV list is seeded on first use.
	await page.goto('/objekte');
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Betriebskosten' })
		.click();
	await expect(page).toHaveURL(/\/betriebskosten$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betriebskosten');
	await expect(page).toHaveTitle('Betriebskosten | mietkartei');
	await expect(page.getByRole('heading', { level: 2, name: 'Neue Abrechnung' })).toBeVisible();

	// Categories: heating and hot water start with their HeizKV key, a combined system with none
	// (§ 9 HeizKV splits it first), everything else allocable with floor area (§ 556a BGB).
	await page
		.getByRole('navigation', { name: 'Bereiche' })
		.getByRole('link', { name: 'Kostenarten' })
		.click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten$/);
	const categories = page.getByRole('table', { name: 'Kostenarten' });
	await expect(categories).toContainText('Grundsteuer');
	await expect(categories).toContainText('Hauswart');
	await expect(categories).toContainText('Verwaltungskosten (nicht umlagefähig)');
	const seededRow = (name: string) =>
		categories.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
	await expect(seededRow('Heizung')).toContainText('Heizung 70/30');
	await expect(seededRow('Warmwasser')).toContainText('Warmwasser 70/30');
	const combined = seededRow('Verbundene Heizungs- und Warmwasserversorgung');
	await expect(combined).toContainText('ja');
	await expect(combined).not.toContainText('70/30');
	await expect(seededRow('Straßenreinigung und Müllbeseitigung')).toContainText('Wohnfläche');

	// A custom key for the property, with a share for its unit.
	await page.goto('/betriebskosten/schluessel');
	const keys = page.getByRole('table', { name: 'Umlageschlüssel' });
	await expect(keys).toContainText('Wohnfläche');
	await expect(keys).toContainText('Beträge je Einheit');
	const keyName = `Miteigentumsanteile ${suffix}`;
	await page.getByLabel('Bezeichnung').fill(keyName);
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('custom');
	await page.getByRole('combobox', { name: 'Objekt' }).selectOption({ label: propertyName });
	await page.getByRole('button', { name: 'Umlageschlüssel anlegen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/schluessel\/[0-9a-f-]+$/);
	await expect(page.getByRole('heading', { level: 2, name: keyName })).toBeVisible();
	await page.getByLabel(unitName).fill('500');
	await page.getByRole('button', { name: 'Anteile speichern' }).click();
	await expect(page.getByText('Die Anteile wurden gespeichert.')).toBeVisible();
	await expect(page.getByLabel(unitName)).toHaveValue('500');

	// A mixed key for heating outside the HeizKV range is refused.
	await page.goto('/betriebskosten/schluessel');
	// The form binds its selects; a choice made before hydration is reset to the default.
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Bezeichnung').fill(`Heizung 80/20 ${suffix}`);
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('mixed');
	await page.getByRole('combobox', { name: 'Zählerart' }).selectOption('heat');
	await page.getByLabel('Anteil nach Verbrauch in %').fill('80');
	await page.getByRole('button', { name: 'Umlageschlüssel anlegen' }).click();
	await expect(page.getByText(/50 bis 70 % nach Verbrauch verteilt/)).toBeVisible();
	await expect(keys).not.toContainText(`Heizung 80/20 ${suffix}`);

	// A billing circle on the property's tab.
	await page.goto(`/objekte/${propertyId}`);
	await page
		.getByRole('navigation', { name: 'Bereiche' })
		.getByRole('link', { name: 'Abrechnungskreise' })
		.click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/abrechnungskreise$`));
	await expect(page.getByText('Dieses Objekt hat noch keine Abrechnungskreise.')).toBeVisible();
	const propertyTabs = page.getByRole('navigation', { name: 'Bereiche' });
	await expect(propertyTabs.getByRole('link', { name: 'Abrechnungskreise' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(propertyTabs.getByRole('link', { name: 'Einheiten' })).not.toHaveAttribute(
		'aria-current'
	);
	const circleName = `Haus A ${suffix}`;
	await page.getByLabel('Bezeichnung').fill(circleName);
	await page.getByRole('button', { name: 'Abrechnungskreis anlegen' }).click();
	await expect(page.getByText('Bitte wähle mindestens eine Einheit aus.')).toBeVisible();
	await page.getByLabel(unitName).check();
	await page.getByRole('button', { name: 'Abrechnungskreis anlegen' }).click();
	const circles = page.getByRole('list', { name: 'Abrechnungskreise' });
	await expect(circles.getByRole('listitem')).toHaveCount(1);
	await expect(circles).toContainText(circleName);
	await expect(circles).toContainText(unitName);

	// The circle can be the default of a category.
	await page.goto('/betriebskosten/kostenarten');
	const categoryName = `Treppenhausreinigung ${suffix}`;
	await page.getByLabel('Bezeichnung').fill(categoryName);
	await page
		.getByRole('combobox', { name: 'Standard-Abrechnungskreis' })
		.selectOption({ label: `${propertyName} – ${circleName}` });
	await page.getByRole('button', { name: 'Kostenart anlegen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten$/);
	const categoryRow = categories.getByRole('row').filter({ hasText: categoryName });
	await expect(categoryRow).toContainText(`${propertyName} – ${circleName}`);
	// Created without a default key, it keeps none on the next load of the list.
	await page.reload();
	await expect(categoryRow).toContainText(`${propertyName} – ${circleName}`);
	await expect(categoryRow).not.toContainText('Wohnfläche');

	// The unit's page leads to its meters; the tab shows all of the property.
	await page.goto(`/objekte/${propertyId}/einheiten/${unitId}`);
	await page.locator('.toolbar').getByRole('link', { name: 'Zähler' }).click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/zaehler\\?unit=${unitId}$`));
	await expect(page.getByText(`${unitName} hat noch keine Zähler.`)).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Bereiche' })
		.getByRole('link', { name: 'Zähler' })
		.click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/zaehler$`));
	await expect(page.getByText('Dieses Objekt hat noch keine Zähler.')).toBeVisible();

	// A heat meter of the unit with two readings; a second reading on the same date is refused.
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

	// A cost item with a receipt file, prefilled with the property and the year of the list.
	await page.goto('/betriebskosten');
	await page
		.getByRole('navigation', { name: 'Bereiche' })
		.getByRole('link', { name: 'Belege' })
		.click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege$/);
	await page.goto(`/betriebskosten/belege?property=${propertyId}&year=2025`);
	await page.getByRole('link', { name: 'Beleg erfassen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/neu\?property=.*&year=2025$/);
	await expect(page.getByRole('combobox', { name: 'Objekt', exact: true })).toHaveValue(propertyId);
	await expect(page.getByLabel('Zeitraum von')).toHaveValue('2025-01-01');
	await expect(page.getByLabel('Zeitraum bis')).toHaveValue('2025-12-31');
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: '1 Grundsteuer' });
	await page.getByRole('combobox', { name: 'Abrechnungskreis' }).selectOption({
		label: `${propertyName} – ${circleName}`
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
	const receipt = page.getByRole('link', { name: 'grundsteuer.txt' });
	await expect(receipt).toHaveAttribute('href', /\/dokumente\/[0-9a-f-]+\/herunterladen$/);
	const receiptHref = (await receipt.getAttribute('href'))!;
	expect((await page.request.get(receiptHref)).status()).toBe(200);

	// The receipt is a document of the item and links back to it.
	const itemId = itemUrl.split('/').pop()!;
	await page.goto(`/dokumente?costItemId=${itemId}`);
	await expect(page.getByRole('form', { name: 'Filter' }).getByLabel('Beleg')).toHaveValue(itemId);
	await expect(
		page
			.getByRole('row')
			.filter({ hasText: 'grundsteuer.txt' })
			.getByRole('link', { name: description })
	).toHaveAttribute('href', `/betriebskosten/belege/${itemId}`);

	// "Speichern und nächsten Beleg" keeps the property and the period for the next one.
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=2025`);
	// The form binds its selects; a choice made before hydration is reset to the default.
	await page.waitForLoadState('networkidle');
	await page
		.getByRole('combobox', { name: 'Kostenart' })
		.selectOption({ label: '8 Straßenreinigung und Müllbeseitigung' });
	const nextDescription = `Müllabfuhr 2025 ${suffix}`;
	await page.getByLabel('Beschreibung').fill(nextDescription);
	await page.getByLabel('Betrag in €').fill('300,00');
	await page.getByRole('button', { name: 'Speichern und nächsten Beleg' }).click();
	await expect(page).toHaveURL(
		/\/betriebskosten\/belege\/neu\?property=.*&from=2025-01-01&to=2025-12-31$/
	);
	await expect(page.getByRole('combobox', { name: 'Objekt', exact: true })).toHaveValue(propertyId);
	await expect(page.getByLabel('Zeitraum von')).toHaveValue('2025-01-01');
	await expect(page.getByLabel('Beschreibung')).toHaveValue('');

	// "Übernehmen" repeats the last Beleg of the category for the next year.
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=2026`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: '1 Grundsteuer' });
	await expect(page.getByText('Letzter Beleg dieser Kostenart: Stadt Berlin')).toBeVisible();
	await page.getByRole('button', { name: 'Übernehmen' }).click();
	await expect(page.getByLabel('Beschreibung')).toHaveValue(`Grundsteuer 2026 ${suffix}`);
	await expect(page.getByLabel('Lieferant (optional)')).toHaveValue('Stadt Berlin');
	await expect(page.getByLabel('Betrag in €')).toHaveValue('1.200,00');
	await expect(
		page.getByRole('combobox', { name: 'Abrechnungskreis' }).locator('option:checked')
	).toHaveText(`${propertyName} – ${circleName}`);

	// The list, filtered by the property and the year, with the sum per category.
	await page.goto(`/betriebskosten/belege?property=${propertyId}&year=2025`);
	const items = page.getByRole('table', { name: 'Belege' });
	await expect(items.getByRole('row').filter({ hasText: description })).toContainText('15.02.2025');
	await expect(items).toContainText('Stadt Berlin');
	await expect(items).toContainText('grundsteuer.txt');
	// The column of the uploaded file is not called "Beleg": a Beleg is the cost item itself.
	await expect(items.getByRole('columnheader', { name: 'Datei' })).toBeVisible();
	await expect(items.getByRole('columnheader', { name: 'Beleg', exact: true })).toHaveCount(0);
	const totals = page.getByRole('table', { name: 'Summe je Kostenart' });
	await expect(totals.getByRole('row').filter({ hasText: 'Grundsteuer' })).toContainText(
		'1.200,00 €'
	);
	await expect(totals.getByRole('row').filter({ hasText: 'Müll' })).toContainText('300,00 €');
	await expect(items.getByRole('row').last()).toContainText('1.500,00 €');

	// Delete the item from its page; the receipt goes with it.
	await page.getByRole('link', { name: description }).click();
	await expect(page).toHaveURL(itemUrl);
	await page.getByRole('button', { name: 'Beleg löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\?property=.*&year=2025$/);
	await expect(items).toContainText(nextDescription);
	await expect(items).not.toContainText(description);
	expect((await page.request.get(receiptHref)).status()).toBe(404);
});

test('edits and deletes categories, keys, circles, cost items, meters and readings', async ({
	page
}) => {
	acceptDialogs(page);
	const tag = crypto.randomUUID().slice(0, 6);
	const propertyName = `Änderungshaus ${tag}`;
	const unitName = `Wohnung OG ${tag}`;
	const { propertyId } = await seedLease(page.request, {
		property: { name: propertyName },
		unit: { name: unitName }
	});

	// A category of its own, renamed on its page.
	const categoryName = `Gartenpflege extra ${tag}`;
	await page.goto('/betriebskosten/kostenarten');
	await page.getByLabel('Bezeichnung').fill(`${categoryName} alt`);
	await page.getByRole('button', { name: 'Kostenart anlegen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten$/);
	const categories = page.getByRole('table', { name: 'Kostenarten' });
	await categories.getByRole('link', { name: `${categoryName} alt` }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten\/[0-9a-f-]+$/);
	const categoryUrl = page.url();
	await page.getByLabel('Bezeichnung').fill(categoryName);
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten$/);
	await expect(categories.getByRole('link', { name: categoryName, exact: true })).toBeVisible();
	await expect(categories).not.toContainText(`${categoryName} alt`);

	// A second category of the same name is refused.
	await page.getByLabel('Bezeichnung').fill(categoryName);
	await page.getByRole('button', { name: 'Kostenart anlegen' }).click();
	await expect(page.getByText('Eine Kostenart mit diesem Namen gibt es schon.')).toBeVisible();

	// A custom key of the property, renamed on its page.
	const keyName = `Gartenanteile ${tag}`;
	await page.goto('/betriebskosten/schluessel');
	// The form binds its selects; a choice made before hydration is reset to the default.
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Bezeichnung').fill(`${keyName} alt`);
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('custom');
	await page.getByRole('combobox', { name: 'Objekt' }).selectOption({ label: propertyName });
	await page.getByRole('button', { name: 'Umlageschlüssel anlegen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/schluessel\/[0-9a-f-]+$/);
	const keyUrl = page.url();
	await page.getByLabel('Bezeichnung').fill(keyName);
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(keyUrl);
	await expect(page.getByRole('heading', { level: 2, name: keyName, exact: true })).toBeVisible();

	// Without a year from the list, the period is last year's and the form says so.
	await page.goto('/betriebskosten/belege/neu');
	const lastYear = new Date().getUTCFullYear() - 1;
	await expect(page.getByLabel('Zeitraum von')).toHaveValue(`${lastYear}-01-01`);
	await expect(page.getByLabel('Zeitraum bis')).toHaveValue(`${lastYear}-12-31`);
	await expect(page.getByText('Vorbelegt mit dem Vorjahr')).toBeVisible();

	// A cost item with both.
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=2025`);
	// The form binds its selects; a choice made before hydration is reset to the default.
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Vorbelegt mit dem Vorjahr')).toHaveCount(0);
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: categoryName });
	await page.getByRole('combobox', { name: 'Umlageschlüssel' }).selectOption({ label: keyName });
	await page
		.getByRole('combobox', { name: 'Abrechnungskreis' })
		.selectOption({ label: 'Alle Einheiten des Objekts' });
	const description = `Gartenpflege 2025 ${tag}`;
	await page.getByLabel('Beschreibung').fill(description);
	await page.getByLabel('Rechnungsdatum').fill('2025-06-30');
	await page.getByLabel('Betrag in €').fill('250,00');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/[0-9a-f-]+$/);
	const itemUrl = page.url();

	// While the item uses them, the category and the key are not deleted; the refusal counts it.
	await page.goto(categoryUrl);
	await page.getByRole('button', { name: 'Kostenart löschen' }).click();
	await expect(page.getByRole('alert')).toContainText(
		/Die Kostenart wird von 1\sBeleg verwendet und kann nicht gelöscht werden\./
	);
	await page.goto(keyUrl);
	await page.getByRole('button', { name: 'Umlageschlüssel löschen' }).click();
	await expect(page.getByRole('alert')).toContainText(
		/Der Umlageschlüssel wird von 1\sBeleg verwendet und kann nicht gelöscht werden\./
	);
	// Nor does the key turn into amounts per unit, which the item does not have.
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('direct');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(
		page.getByText(
			'Der Umlageschlüssel wird von Belegen verwendet; er kann nicht zu Beträgen je Einheit oder davon weg wechseln.',
			{ exact: false }
		)
	).toBeVisible();

	// The item is edited to amounts per unit, which are entered on its page.
	await page.goto(itemUrl);
	await page
		.getByRole('combobox', { name: 'Umlageschlüssel' })
		.selectOption({ label: 'Beträge je Einheit' });
	await page.getByLabel('Betrag in €').fill('300,00');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(itemUrl);
	const details = page.locator('dl.details');
	await expect(details).toContainText('Beträge je Einheit');
	await expect(details).toContainText('300,00 €');
	await page.getByLabel(`${unitName} in €`).fill('300,00');
	await page.getByRole('button', { name: 'Beträge speichern' }).click();
	await expect(page.getByText('Die Beträge wurden gespeichert.')).toBeVisible();
	await expect(page.getByLabel(`${unitName} in €`)).toHaveValue('300,00');
	await expect(page.getByText(/Summe der Beträge:\s300,00\s€ von 300,00\s€\./)).toBeVisible();

	// The key is free now and goes; then the item, then the category.
	await page.goto(keyUrl);
	await page.getByRole('button', { name: 'Umlageschlüssel löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/schluessel$/);
	await expect(page.getByRole('table', { name: 'Umlageschlüssel' })).not.toContainText(keyName);
	await page.goto(itemUrl);
	await page.getByRole('button', { name: 'Beleg löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\?/);
	await page.goto(categoryUrl);
	await page.getByRole('button', { name: 'Kostenart löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten$/);
	await expect(categories).not.toContainText(categoryName);

	// A circle, renamed on its page (it keeps at least one unit), then deleted.
	await page.goto(`/objekte/${propertyId}/abrechnungskreise`);
	await page.getByLabel('Bezeichnung').fill(`Haus B ${tag}`);
	await page.getByLabel(unitName).check();
	await page.getByRole('button', { name: 'Abrechnungskreis anlegen' }).click();
	const circles = page.getByRole('list', { name: 'Abrechnungskreise' });
	await circles.getByRole('link', { name: `Haus B ${tag}` }).click();
	await expect(page).toHaveURL(/\/abrechnungskreise\/[0-9a-f-]+$/);
	const circleUrl = page.url();
	const propertyTabs = page.getByRole('navigation', { name: 'Bereiche' });
	await expect(propertyTabs.getByRole('link', { name: 'Abrechnungskreise' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(propertyTabs.getByRole('link', { name: 'Einheiten' })).not.toHaveAttribute(
		'aria-current'
	);
	await page.getByLabel('Bezeichnung').fill(`Haus C ${tag}`);
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/abrechnungskreise$`));
	await expect(circles.getByRole('listitem')).toHaveCount(1);
	await expect(circles).toContainText(`Haus C ${tag}`);
	await expect(circles).not.toContainText(`Haus B ${tag}`);
	await expect(circles).toContainText(unitName);
	await page.goto(circleUrl);
	await page.getByRole('button', { name: 'Abrechnungskreis löschen' }).click();
	await expect(page.getByText('Dieses Objekt hat noch keine Abrechnungskreise.')).toBeVisible();

	// A meter: a reading entered and deleted, the meter removed, then deleted.
	await page.goto(`/objekte/${propertyId}/zaehler`);
	await expect(propertyTabs.getByRole('link', { name: 'Zähler' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(propertyTabs.getByRole('link', { name: 'Einheiten' })).not.toHaveAttribute(
		'aria-current'
	);
	await page
		.getByRole('combobox', { name: 'Einheit', exact: true })
		.selectOption({ label: unitName });
	await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('cold_water');
	await page.getByLabel('Zählernummer (optional)').fill(`KW-${tag}`);
	await page.getByRole('button', { name: 'Zähler anlegen' }).click();
	await expect(page).toHaveURL(/\/zaehler\?meter=[0-9a-f-]+$/);
	const readings = page.getByRole('region', { name: 'Zählerstände' });
	await readings.getByLabel('Abgelesen am').fill('2025-01-01');
	await readings.getByLabel(/^Stand in/).fill('12,5');
	await readings.getByRole('button', { name: 'Zählerstand erfassen' }).click();
	await expect(readings.getByRole('table')).toContainText('01.01.2025');
	// The date opens the reading in a dialog: change it, then delete it there.
	await readings.getByRole('table').getByRole('link', { name: '01.01.2025' }).click();
	const reading = page.getByRole('dialog', { name: 'Zählerstand bearbeiten' });
	await reading.getByLabel(/^Stand in/).fill('13,5');
	await reading.getByRole('button', { name: 'Speichern' }).click();
	await expect(reading).toBeHidden();
	await expect(readings.getByRole('table')).toContainText('13,5');
	await readings.getByRole('table').getByRole('link', { name: '01.01.2025' }).click();
	await reading.getByRole('button', { name: 'Löschen' }).click();
	await expect(readings).toContainText('Noch kein Zählerstand erfasst.');

	await readings.getByLabel('Ausgebaut am').fill('2025-06-30');
	await readings.getByRole('button', { name: 'Zähler ausbauen' }).click();
	const meters = page.getByRole('table', { name: `Zähler ${unitName}` });
	const meterRow = meters.getByRole('row').filter({ hasText: `KW-${tag}` });
	await expect(meterRow).toContainText('30.06.2025');
	await meterRow.getByRole('link', { name: 'Stände' }).click();
	await page
		.getByRole('region', { name: 'Zählerstände' })
		.getByRole('button', { name: 'Zähler löschen' })
		.click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/zaehler$`));
	await expect(page.getByText('Dieses Objekt hat noch keine Zähler.')).toBeVisible();
});

test('takes the amounts per lease of a unit that changed tenants', async ({ page }) => {
	const propertyName = `Wechselhaus ${suffix}`;
	const { propertyId } = await seedLease(page.request, {
		property: { name: propertyName },
		unit: { name: `Wohnung OG ${suffix}` },
		tenant: { firstName: 'Ida', lastName: `Vormieter ${suffix}` },
		lease: { endDate: '2025-06-30' }
	});
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=2025`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: '4 Heizung' });
	await page
		.getByRole('combobox', { name: 'Umlageschlüssel' })
		.selectOption({ label: 'Beträge je Einheit' });
	await page.getByLabel('Beschreibung').fill(`Heizkosten Messdienst ${suffix}`);
	await page.getByLabel('Betrag in €').fill('500,00');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/[0-9a-f-]+$/);

	// Moved out on 30 June, empty since: one field for the lease, one for the whole unit.
	const lease = page.getByLabel(/Ida Vormieter .* \(01\.01\.2025 – 30\.06\.2025\) in €/);
	await lease.fill('320,00');
	await page.getByLabel('Oder ganze Einheit in €').fill('500,00');
	await page.getByRole('button', { name: 'Beträge speichern' }).click();
	await expect(
		page.getByText('Trage entweder den Betrag der Einheit ein oder die Beträge je Mietvertrag.')
	).toBeVisible();
	await page.getByLabel('Oder ganze Einheit in €').fill('');
	await page.getByRole('button', { name: 'Beträge speichern' }).click();
	await expect(page.getByText('Die Beträge wurden gespeichert.')).toBeVisible();
	await page.reload();
	await expect(lease).toHaveValue('320,00');
	await expect(
		page.getByText(/Summe der Beträge:\s320,00\s€ von 500,00\s€, Differenz/)
	).toBeVisible();
});

test('answers unknown or foreign setup rows, meters and cost items with 404', async ({ page }) => {
	const { propertyId } = await seedLease(page.request);
	const foreign = await seedForeignLease(page.request);
	for (const path of [
		'/betriebskosten/kostenarten/does-not-exist',
		'/betriebskosten/schluessel/does-not-exist',
		'/betriebskosten/belege/does-not-exist',
		`/objekte/${propertyId}/abrechnungskreise/does-not-exist`,
		`/objekte/${foreign.propertyId}/abrechnungskreise`,
		`/objekte/${foreign.propertyId}/zaehler`
	]) {
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(404);
	}
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');

	// Form actions with ids of another account or another property are refused as well.
	const origin = new URL(page.url()).origin;
	const post = (path: string, form: Record<string, string>) =>
		page.request.post(path, { form, headers: { origin }, maxRedirects: 0 });
	expect(
		(
			await post(`/objekte/${foreign.propertyId}/zaehler?/createMeter`, {
				kind: 'heat',
				unit: 'kWh'
			})
		).status()
	).toBe(404);
	expect(
		(
			await post(`/objekte/${propertyId}/zaehler?/deleteMeter`, { meterId: 'does-not-exist' })
		).status()
	).toBe(404);
	const foreignUnit = await post(`/objekte/${propertyId}/zaehler?/createMeter`, {
		unitId: foreign.unitId,
		kind: 'heat',
		unit: 'kWh'
	});
	expect(foreignUnit.status()).toBe(400);
	expect(await foreignUnit.text()).toContain('Diese Einheit gehört nicht zu diesem Objekt.');
	expect((await post('/betriebskosten/belege/does-not-exist?/delete', {})).status()).toBe(404);
});
