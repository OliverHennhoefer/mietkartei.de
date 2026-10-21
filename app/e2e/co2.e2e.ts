import { expect, test } from '@playwright/test';
import { seedLease } from './seed';

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
	await row.getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByText('Noch keine CO₂-Kostenaufteilung')).toBeVisible();
	await expect(table).toHaveCount(0);
	await page.goto(ledger);
	await expect(page.getByRole('heading', { level: 2, name: 'Mietkonto' })).toBeVisible();
	await expect(credits).toHaveCount(0);
});

test('answers the CO₂ tab of an unknown lease with 404', async ({ page }) => {
	const response = await page.goto('/vertraege/does-not-exist/co2');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
