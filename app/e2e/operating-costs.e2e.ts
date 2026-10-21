import { expect, test, type Page } from '@playwright/test';
import { seedForeignLease, seedLease } from './seed';

// The operating costs setup: categories and keys under /betriebskosten, circles on the property's
// tab. The lease (property, unit, tenant) is seeded; the test drives only the pages of this
// feature.

const suffix = crypto.randomUUID().slice(0, 6);

/** ConfirmButton asks with window.confirm; every dialog of the test is accepted. */
function acceptDialogs(page: Page) {
	page.on('dialog', (dialog) => dialog.accept());
}

test('sets up categories, keys and circles', async ({ page }) => {
	const unitName = `Wohnung EG ${suffix}`;
	const propertyName = `Betriebskostenhaus ${suffix}`;
	const { propertyId } = await seedLease(page.request, {
		property: { name: propertyName },
		unit: { name: unitName }
	});

	// The overview lists what is set up; the BetrKV list is seeded on first use.
	await page.goto('/objekte');
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Betriebskosten' })
		.click();
	await expect(page).toHaveURL(/\/betriebskosten$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betriebskosten');
	await expect(page).toHaveTitle('Betriebskosten · mietkartei');
	const overview = page.getByRole('list', { name: 'Stammdaten' });
	await expect(overview).toContainText(/\d+\sKostenarten, davon \d+ umlagefähig/);
	await expect(overview).toContainText(/\d+\sUmlageschlüssel/);
	await expect(
		page
			.getByRole('list', { name: 'Abrechnungskreise je Objekt' })
			.getByRole('listitem')
			.filter({ hasText: propertyName })
	).toContainText('keine Abrechnungskreise');

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
});

test('edits and deletes categories, keys and circles', async ({ page }) => {
	acceptDialogs(page);
	const tag = crypto.randomUUID().slice(0, 6);
	const propertyName = `Änderungshaus ${tag}`;
	const unitName = `Wohnung OG ${tag}`;
	const { propertyId } = await seedLease(page.request, {
		property: { name: propertyName },
		unit: { name: unitName }
	});

	// A category of its own, renamed on its page, then deleted.
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

	await page.goto(categoryUrl);
	await page.getByRole('button', { name: 'Kostenart löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/kostenarten$/);
	await expect(categories).not.toContainText(categoryName);

	// A custom key of the property, renamed on its page, then deleted.
	const keyName = `Gartenanteile ${tag}`;
	await page.goto('/betriebskosten/schluessel');
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
	await page.getByRole('button', { name: 'Umlageschlüssel löschen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/schluessel$/);
	await expect(page.getByRole('table', { name: 'Umlageschlüssel' })).not.toContainText(keyName);

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
});

test('answers unknown categories, keys and circles with 404', async ({ page }) => {
	const { propertyId } = await seedLease(page.request);
	const foreign = await seedForeignLease(page.request);
	for (const path of [
		'/betriebskosten/kostenarten/does-not-exist',
		'/betriebskosten/schluessel/does-not-exist',
		`/objekte/${propertyId}/abrechnungskreise/does-not-exist`,
		`/objekte/${foreign.propertyId}/abrechnungskreise`
	]) {
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(404);
	}
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
