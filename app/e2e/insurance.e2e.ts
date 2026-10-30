import { expect, test } from '@playwright/test';
import { seedRows } from './seed';

// A Versicherung of its own property: its notice deadline among the Fristen and its premium as a
// prefilled Beleg. The name carries a random suffix, so other tests' rows are told apart.

const suffix = crypto.randomUUID().slice(0, 6);
const propertyName = `Versicherungshaus ${suffix}`;
const insurer = `Hausrat AG ${suffix}`;

test('records a policy, lists its notice deadline and enters its premium as a Beleg', async ({
	page
}) => {
	const {
		ids: [propertyId]
	} = await seedRows(page.request, 'properties', [
		{ name: propertyName, street: 'Policenweg 1', postalCode: '10115', city: 'Berlin' }
	]);

	await page.goto(`/objekte/${propertyId}/versicherungen`);
	await expect(page.getByRole('heading', { level: 2, name: 'Versicherungen' })).toBeVisible();
	await page.getByLabel('Art').selectOption({ label: 'Wohngebäudeversicherung' });
	await page.getByLabel('Versicherer').fill(insurer);
	await page.getByLabel('Jahresbeitrag in €').fill('1.200,00');
	await page.getByLabel('Hauptfälligkeit').fill('2024-01-01');
	await page.getByRole('button', { name: 'Versicherung anlegen' }).click();

	const policy = page.getByRole('list', { name: 'Versicherungen' }).getByRole('listitem').first();
	await expect(policy).toContainText(insurer);
	await expect(policy).toContainText('Hauptfälligkeit 01.01.');

	// The notice deadline is 30 September before each renewal on 1 January.
	await page.goto('/fristen');
	const row = page
		.getByRole('list', { name: 'Fristen' })
		.getByRole('listitem')
		.filter({ hasText: insurer });
	await expect(row).toContainText('Kündigungsfrist Wohngebäudeversicherung');
	await expect(row).toContainText('30.09.');

	await page.goto(`/objekte/${propertyId}/versicherungen`);
	const year = new Date().getFullYear();
	await page
		.getByRole('list', { name: 'Belege zu Wohngebäudeversicherung' })
		.getByRole('listitem')
		.filter({ hasText: `01.01.${year} bis 31.12.${year}` })
		.getByRole('link', { name: 'als Beleg erfassen' })
		.click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/neu\?versicherung=/);
	await expect(page.getByLabel('Lieferant (optional)')).toHaveValue(insurer);
	await expect(page.getByLabel('Betrag in €')).toHaveValue('1.200,00');
	await expect(page.getByLabel('Zeitraum von')).toHaveValue(`${year}-01-01`);
	const category = page.getByRole('combobox', { name: 'Kostenart', exact: true });
	await expect
		.poll(() => category.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.text))
		.toContain('Sach- und Haftpflichtversicherung');

	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/belege\/[\w-]+/);
	await page.goto(`/objekte/${propertyId}/versicherungen`);
	await expect(
		page
			.getByRole('list', { name: 'Belege zu Wohngebäudeversicherung' })
			.getByRole('listitem')
			.filter({ hasText: `01.01.${year} bis 31.12.${year}` })
			.getByRole('link', { name: 'Beleg erfasst' })
	).toBeVisible();
});
