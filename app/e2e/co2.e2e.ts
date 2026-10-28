import { expect, test } from '@playwright/test';
import { seedForeignLease, seedLease } from './seed';

// The CO₂ tab of a lease: the tenant bought 25.000 kWh gas for 2025 (5.025 kg CO₂, 300 € CO₂
// cost) in a 72,5 m² flat of a residential building → 69,3 kg/m² → landlord 95 % = 285,00 €.
test('splits the CO₂ cost of a tenant with an own fuel contract and credits the landlord share', async ({
	page
}) => {
	const { leaseId } = await seedLease(page.request, { unit: { floorArea: 72.5 } });
	await page.goto(`/vertraege/${leaseId}/co2`);
	await expect(page.getByRole('heading', { level: 2, name: 'CO₂-Kostenaufteilung' })).toBeVisible();
	await expect(page.getByText('Noch keine CO₂-Kostenaufteilung')).toBeVisible();
	await expect(page.getByLabel('Wohnfläche in m²')).toHaveValue('72,5');

	// Without the kg, the action prefills them from the kWh and asks for confirmation.
	await page.getByLabel('Jahr').fill('2025');
	await page.getByLabel('Brennstoff').selectOption({ label: 'Erdgas' });
	await page.getByLabel('Verbrauch in kWh (optional)').fill('25000');
	await page.getByLabel('CO₂-Kosten in €').fill('300,00');
	await page.getByRole('button', { name: 'CO₂-Kosten aufteilen' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Aus 25.000 kWh Erdgas ergeben sich 5.025 kg CO₂.'
	);
	await expect(page.getByLabel('CO₂-Menge in kg')).toHaveValue('5025');
	await expect(page.getByText('Noch keine CO₂-Kostenaufteilung')).toBeVisible();

	// Confirming the prefilled kg saves the split and posts the credit.
	await page.getByRole('button', { name: 'CO₂-Kosten aufteilen' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Die CO₂-Kostenaufteilung 2025 ist gebucht: Gutschrift über 285,00 €'
	);
	const table = page.getByRole('table', { name: 'CO₂-Kostenaufteilungen' });
	const row = table.getByRole('row').filter({ hasText: 'Erdgas' });
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('2025');
	await expect(row).toContainText('5.025 kg');
	await expect(row).toContainText('69,3 kg/m²');
	await expect(row).toContainText('Stufe 10');
	await expect(row).toContainText('95 %');
	await expect(row).toContainText('285,00 €');
	await expect(row.getByText('Frist abgelaufen')).toHaveCount(0);

	// One split per year: the second attempt is refused with a sentence.
	await page.getByLabel('Jahr').fill('2025');
	await page.getByLabel('Verbrauch in kWh (optional)').fill('25000');
	await page.getByLabel('CO₂-Menge in kg').fill('5025');
	await page.getByLabel('CO₂-Kosten in €').fill('300,00');
	await page.getByRole('button', { name: 'CO₂-Kosten aufteilen' }).click();
	await expect(
		page.getByText('Für 2025 gibt es schon eine CO₂-Kostenaufteilung.', { exact: false })
	).toBeVisible();
	await expect(table.getByRole('row').filter({ hasText: 'Erdgas' })).toHaveCount(1);

	// The credit is on the Mietkonto (due within 12 months of the claim).
	const ledger = `/vertraege/${leaseId}/mietkonto?from=2025-01&to=2099-12`;
	const credits = page
		.getByRole('table', { name: 'Buchungen' })
		.getByRole('row')
		.filter({ hasText: 'CO₂-Erstattung' });
	await page.goto(ledger);
	await expect(credits).toHaveCount(1);
	await expect(credits).toContainText('285,00 €');

	// Deleting removes the split and its credit.
	await page.goto(`/vertraege/${leaseId}/co2`);
	page.once('dialog', (dialog) => dialog.accept());
	await row.getByRole('link', { name: '2025' }).click();
	await page
		.getByRole('dialog', { name: 'CO₂-Kostenaufteilung 2025' })
		.getByRole('button', { name: 'Löschen' })
		.click();
	await expect(page.getByText('Noch keine CO₂-Kostenaufteilung')).toBeVisible();
	await expect(table).toHaveCount(0);
	await page.goto(ledger);
	await expect(page.getByRole('heading', { level: 2, name: 'Mietkonto' })).toBeVisible();
	await expect(credits).toHaveCount(0);
});

test('answers the CO₂ tab of an unknown or foreign lease with 404', async ({ page }) => {
	const foreign = await seedForeignLease(page.request);
	for (const leaseId of ['does-not-exist', foreign.leaseId]) {
		const response = await page.goto(`/vertraege/${leaseId}/co2`);
		expect(response?.status()).toBe(404);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
	}
	// The actions refuse the foreign lease too, before anything is stored.
	const origin = new URL(page.url()).origin;
	const created = await page.request.post(`/vertraege/${foreign.leaseId}/co2?/create`, {
		form: {
			year: '2025',
			fuel: 'gas',
			co2Kg: '5025',
			co2Cost: '300,00',
			area: '72,5',
			claimedOn: '2026-03-15'
		},
		headers: { origin }
	});
	expect(created.status()).toBe(404);
});

// A fuel bill of a central heating: the cost item keeps the fuel figures for the statement and
// computes the kg from the kWh when the invoice does not state them.
test('records the fuel figures of a heating bill', async ({ page }) => {
	const { propertyId } = await seedLease(page.request);
	await page.goto(`/betriebskosten/belege/neu?property=${propertyId}&year=2025`);
	await page.getByRole('combobox', { name: 'Kostenart' }).selectOption({ label: '4 Heizung' });
	await page.getByLabel('Beschreibung').fill('Gasrechnung 2025');
	await page.getByLabel('Betrag in €').fill('3.000,00');
	await page.getByRole('combobox', { name: /^Brennstoff/ }).selectOption({ label: 'Erdgas' });
	await page.getByLabel('Energiemenge in kWh').fill('25000');
	await page.getByLabel('CO₂-Kosten in €').fill('300,00');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/[^/?]+$/);
	await expect(page.getByRole('heading', { level: 2, name: 'Gasrechnung 2025' })).toBeVisible();
	await expect(page.locator('dl')).toContainText(
		'Erdgas, 25.000 kWh, 5.025 kg CO₂, CO₂-Kosten 300,00 €'
	);
	await expect(page.getByLabel('CO₂-Menge in kg')).toHaveValue('5025');
});
