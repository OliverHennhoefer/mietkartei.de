import { expect, test } from '@playwright/test';
import { addMonths, firstOfMonth, monthOf, today } from '../src/lib/dates';
import { seedLease, seedRows } from './seed';

// The dashboard: the tiles link to their lists and count what the account holds. The lease is
// seeded two months back without a payment, so it is in arrears; its property gets a second,
// empty unit, which is vacant.

const suffix = crypto.randomUUID().slice(0, 6);
const startDate = firstOfMonth(monthOf(addMonths(firstOfMonth(monthOf(today())), -2)));

test('shows the tiles with arrears, vacancy, open transactions and deadlines', async ({ page }) => {
	const { propertyId } = await seedLease(page.request, {
		tenant: { lastName: `Übersicht-${suffix}` },
		lease: { startDate }
	});
	await seedRows(page.request, 'units', [
		{ propertyId, name: `Leer-${suffix}`, kind: 'apartment', floorArea: 48 }
	]);

	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
	await expect(page).toHaveTitle('Übersicht · mietkartei');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toHaveCount(0);

	const tiles = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(tiles).toHaveCount(4);
	const arrears = tiles.nth(0);
	await expect(arrears).toContainText('Rückstände');
	await expect(arrears.getByRole('link')).toHaveAttribute('href', '/mietkonto?filter=rueckstaende');
	await expect(arrears.locator('.value')).not.toHaveText('0,00 €');
	const vacancy = tiles.nth(1);
	await expect(vacancy).toContainText('Leerstand');
	await expect(vacancy.getByRole('link')).toHaveAttribute('href', '/objekte');
	await expect(vacancy.locator('.value')).not.toHaveText('0');
	await expect(tiles.nth(2).getByRole('link')).toHaveAttribute('href', '/bank');
	await expect(tiles.nth(2)).toContainText('Bankumsätze');
	await expect(tiles.nth(3).getByRole('link')).toHaveAttribute('href', '/aufgaben');
	await expect(tiles.nth(3)).toContainText('in den nächsten 12 Monaten');

	// The vacant unit is listed with a link into the lease form, preselected.
	const vacant = page
		.getByRole('list', { name: 'Leer stehende Einheiten' })
		.getByRole('listitem')
		.filter({ hasText: `Leer-${suffix}` });
	await expect(vacant).toBeVisible();
	await vacant.getByRole('link', { name: 'Mietvertrag anlegen' }).click();
	await expect(page).toHaveURL(/\/vertraege\/neu\?unitId=/);
	const unit = page.getByRole('combobox', { name: 'Einheit', exact: true });
	await expect(unit.locator('option:checked')).toHaveText(new RegExp(`Leer-${suffix}`));
});
