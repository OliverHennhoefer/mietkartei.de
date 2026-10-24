import { expect, test } from '@playwright/test';
import { pdfText } from './pdf-text';
import { seedLease } from './seed';

// An Eigentumswohnung in a WEG: the property carries the Verwalter and the MEA, a Beleg the
// figures of the Hausgeldabrechnung, and the statement prints how the share came about.

test('creates an Eigentumswohnung with Verwalter and MEA', async ({ page }) => {
	const name = `ETW Lindenstraße ${crypto.randomUUID().slice(0, 6)}`;
	await page.goto('/objekte/neu');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Bezeichnung').fill(name);
	await page.getByLabel('Straße und Hausnummer').fill('Lindenstraße 4');
	await page.getByLabel('Postleitzahl').fill('10115');
	await page.getByLabel('Ort').fill('Berlin');
	await expect(page.getByLabel(/^Verwalter/)).toHaveCount(0);
	await page.getByLabel('Objektart').selectOption({ label: 'Eigentumswohnung in einer WEG' });
	await page.getByLabel(/^Verwalter/).fill('Hausverwaltung Meier');
	await page.getByLabel('Miteigentumsanteil der Wohnung').fill('85');
	await page.getByLabel('Miteigentumsanteile der WEG').fill('1000');
	await page.getByRole('button', { name: 'Objekt anlegen' }).click();

	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
	await expect(page.getByText('Eigentumswohnung in einer WEG, MEA 85 von 1.000')).toBeVisible();
	await expect(page.getByText('Verwalter Hausverwaltung Meier')).toBeVisible();
});

test('prints the cost of the WEG, its key and the share on the statement', async ({ page }) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	const year = Number(new Date().getFullYear()) - 1;
	const { propertyId, leaseId } = await seedLease(page.request, {
		property: { kind: 'condominium', ownershipShare: 85, ownershipShareTotal: 1000 },
		unit: { name: `Wohnung 3 ${suffix}`, floorArea: 72.3 },
		lease: { startDate: `${year}-01-01` }
	});

	// The form offers the WEG fields with the MEA of the property.
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=${year}`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: '14 Hauswart' });
	await page.getByLabel('Beschreibung').fill(`Hauswart laut Hausgeldabrechnung ${suffix}`);
	await page.getByLabel('Lieferant (optional)').fill('Hausverwaltung Meier');
	await expect(page.getByLabel('Schlüssel der WEG')).toHaveValue('MEA');
	await expect(page.getByLabel('Summe des Schlüssels in der WEG')).toHaveValue('1000');
	await expect(page.getByLabel('Anteil der Wohnung')).toHaveValue('85');
	await page.getByLabel('Betrag in €').fill('357,00');
	await page.getByLabel('Gesamtkosten der WEG in €').fill('4.200,00');
	await expect(page.getByText('85 von 1.000 ergeben 357,00 €.')).toBeVisible();
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/[0-9a-f-]+$/);
	await expect(page.locator('dl.details')).toContainText('Gesamt 4.200,00 € · MEA 85 von 1.000');

	await page.goto('/betriebskosten');
	await page.getByLabel('Objekt').selectOption({ value: propertyId });
	await page.getByLabel('Zeitraum von').fill(`${year}-01-01`);
	await page.getByLabel('Zeitraum bis').fill(`${year}-12-31`);
	await page.getByRole('button', { name: 'Entwurf erstellen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/abrechnungen\/[0-9a-f-]{36}$/);
	const statementUrl = page.url();
	const lease = page.getByRole('region', { name: `Mietvertrag Wohnung 3 ${suffix}` });
	await expect(lease).toContainText('MEA der WEG: 1.000');
	await expect(lease).toContainText('Gesamt 4.200,00 € · MEA 85 von 1.000 · Anteil 357,00 €');
	await expect(lease).not.toContainText('72,3 m² von 72,3 m²');

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: /^Freigeben: / }).click();
	await expect(page.getByText('auf den Mietkonten gebucht')).toBeVisible();
	const response = await page.request.get(`${statementUrl}/pdf/${leaseId}`);
	expect(response.status()).toBe(200);
	const text = (await pdfText(await response.body())).replace(/\s+/g, ' ');
	expect(text).toContain('4.200,00 € WEG');
	expect(text).toContain('Gesamt 4.200,00 € · MEA 85 von 1.000 · Anteil 357,00 €');
});
