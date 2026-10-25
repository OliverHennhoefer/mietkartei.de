import { expect, test } from '@playwright/test';
import { today } from '../src/lib/dates';
import { seedLease } from './seed';

// The Auswertung end to end: an expense entered by hand on the seeded unit shows up in the
// year's list, in the property's figures and in the unit comparison. The lease is seeded; only
// the /auswertung pages are driven. The property filter keeps other tests' rows out.

const suffix = crypto.randomUUID().slice(0, 6);
const propertyName = `Auswertungshaus ${suffix}`;
const unitName = `Wohnung ${suffix}`;
const year = today().slice(0, 4);

test('enters an expense and finds it in the analysis of its property', async ({ page }) => {
	const { propertyId } = await seedLease(page.request, {
		property: { name: propertyName },
		unit: { name: unitName }
	});

	await page.goto('/auswertung/ausgaben');
	await expect(page.getByRole('heading', { level: 1, name: 'Ausgaben' })).toBeVisible();
	await page.getByLabel('Datum').fill(`${year}-01-15`);
	await page.getByLabel('Betrag').fill('1.234,50');
	await page.getByLabel('Kategorie').selectOption({ label: 'Instandhaltung und Reparaturen' });
	await page.getByLabel('Betrifft').selectOption({ label: unitName });
	await page.getByLabel('Beschreibung').fill(`Therme ${suffix}`);
	await page.getByRole('button', { name: 'Ausgabe erfassen' }).click();
	await expect(page.getByRole('status')).toHaveText('Die Ausgabe wurde erfasst.');
	await expect(
		page.getByRole('table', { name: `Ausgaben ${year}` }).getByRole('row', {
			name: new RegExp(`Therme ${suffix}`)
		})
	).toContainText(`${unitName} · ${propertyName}`);

	// The description again brings its category and scope along.
	await page.goto('/auswertung/ausgaben');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Beschreibung').fill(`Therme ${suffix}`);
	await page.getByLabel('Beschreibung').blur();
	await expect(page.getByLabel('Kategorie').locator('option:checked')).toHaveText(
		'Instandhaltung und Reparaturen'
	);
	await expect(page.getByLabel('Betrifft').locator('option:checked')).toHaveText(unitName);

	await page.goto(`/auswertung?jahr=${year}&objekt=${propertyId}`);
	const tiles = page.getByRole('list', { name: `Kennzahlen ${year}` });
	await expect(tiles.getByRole('listitem').filter({ hasText: `Ausgaben ${year}` })).toContainText(
		'1.234,50 €'
	);
	await expect(page.getByRole('list', { name: 'Ausgaben nach Kategorie' })).toContainText(
		'Instandhaltung und Reparaturen'
	);
	await expect(page.getByRole('img', { name: /Einnahmen und Ausgaben je Monat/ })).toBeVisible();
	await page.getByRole('link', { name: 'Einheiten im Vergleich' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Objekte im Vergleich' })).toBeVisible();
	await expect(page.getByRole('row', { name: new RegExp(unitName) })).toContainText('1.234,50 €');

	await page.goto(`/auswertung/mieteinnahmen?objekt=${propertyId}`);
	await expect(
		page.getByRole('img', { name: 'Verlangte und eingegangene Miete je Jahr' })
	).toBeVisible();

	await page.goto(`/auswertung?jahr=${year}&objekt=${propertyId}`);

	await page.getByLabel('Zeitraum').selectOption('gesamt');
	await expect(page).toHaveURL(/jahr=gesamt/);
	await expect(page.getByRole('heading', { name: 'Verlauf nach Jahren' })).toBeVisible();

	await page.goto(`/auswertung/rendite?objekt=${propertyId}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Rendite und Cashflow' })).toBeVisible();
	await page.getByLabel('Anschaffungskosten').fill('300000');
	await page.getByLabel('Darlehenssumme').fill('240000');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('status')).toHaveText('Gespeichert.');
	await expect(page.getByText('Eigenkapital 60.000,00 €')).toBeVisible();
	await expect(page.getByRole('img', { name: /Vom Mieteingang zum Cashflow/ })).toBeVisible();

	// The comparison loads with whatever cost items the other tests booked.
	await page.goto('/auswertung/nebenkosten');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Nebenkosten-Vergleich' })
	).toBeVisible();
});
