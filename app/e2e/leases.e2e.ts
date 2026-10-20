import { expect, test, type Page } from '@playwright/test';
import { seedRows } from './seed';

// Leases: the whole life of one lease on the pages this feature owns. Property, unit and
// tenant are seeded as raw rows (the portfolio and tenant pages are not driven here).

const suffix = () => Math.random().toString(36).slice(2, 8);

async function seedUnitAndTenant(page: Page) {
	const s = suffix();
	const property = await seedRows(page.request, 'properties', [
		{ name: `Haus ${s}`, street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' }
	]);
	const unit = await seedRows(page.request, 'units', [
		{ propertyId: property.ids[0], name: `Wohnung ${s}`, kind: 'apartment', floorArea: 64 }
	]);
	const tenant = await seedRows(page.request, 'tenants', [
		{ firstName: 'Erika', lastName: `Vertrag-${s}` }
	]);
	return {
		unitId: unit.ids[0],
		tenantId: tenant.ids[0],
		label: `Wohnung ${s} · Haus ${s}`,
		tenantName: `Erika Vertrag-${s}`
	};
}

test('creates a lease with an opening balance, keeps its history and ends it', async ({ page }) => {
	const { unitId, tenantId, label, tenantName } = await seedUnitAndTenant(page);
	page.on('dialog', (dialog) => dialog.accept());

	// The unit and the tenant come preselected from the query string.
	await page.goto(`/vertraege/neu?unitId=${unitId}&tenantId=${tenantId}`);
	await expect(page.locator('select[name="unitId"]')).toHaveValue(unitId);
	await expect(page.getByRole('checkbox', { name: tenantName })).toBeChecked();
	await page.getByLabel('Beginn', { exact: true }).fill('2025-01-01');
	// Amounts by name: the hints of other fields mention Kaltmiete and Kaution too.
	await page.locator('input[name="baseRent"]').fill('600,00');
	await page.locator('input[name="operatingCostPrepayment"]').fill('150,00');
	await page.locator('input[name="heatingCostPrepayment"]').fill('50,00');
	await page.locator('input[name="securityDeposit"]').fill('1.800,00');
	await page.locator('input[name="openingBalance"]').fill('120,00');
	await page.getByRole('button', { name: 'Mietvertrag anlegen' }).click();

	// Overview: the lease started in the past, so the ledger starts this month: one full rent
	// (800 €) plus the opening balance (120 €) = 920 € Rückstand, whatever month it is.
	await expect(page).toHaveURL(/\/vertraege\/(?!neu)[^/?]+$/);
	const leaseUrl = page.url();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
	await expect(page.getByText(tenantName)).toHaveCount(2);
	await expect(page.getByLabel('Aktuelle Miete')).toContainText(/800,00\s€/);
	await expect(page.getByLabel('Saldo')).toContainText('Rückstand');
	await expect(page.getByLabel('Saldo')).toContainText(/920,00\s€/);
	await expect(page.getByLabel('Kaution', { exact: true })).toContainText(/1\.800,00\s€/);

	// Persons history: the initial row and one added "ab Datum".
	const persons = page.getByRole('table', { name: 'Personenstand' });
	await expect(persons.getByRole('row')).toHaveCount(2);
	await page.getByLabel('Personen ab Datum').fill('2026-01-01');
	await page.getByLabel('Personen', { exact: true }).fill('3');
	await page.getByLabel('Notiz (optional)').fill('Kind geboren');
	await page.getByRole('button', { name: 'Personenstand eintragen' }).click();
	await expect(persons.getByRole('row')).toHaveCount(3);
	await expect(persons).toContainText('01.01.2026');
	await expect(persons).toContainText('Kind geboren');

	// Edit: the due day and the notes; the amounts stay with the Miethöhe tab.
	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	await expect(page.getByText('Miete bei Vertragsbeginn:')).toBeVisible();
	await page.getByLabel('Fälligkeit (Werktag des Monats)').fill('5');
	await page.getByLabel('Notizen (optional)').fill('Schlüssel übergeben');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(leaseUrl);
	await expect(page.getByText('am 5. Werktag des Monats')).toBeVisible();
	await expect(page.getByText('Schlüssel übergeben')).toBeVisible();

	// Kaution tab: three instalments while nothing is paid in, one movement, the summary.
	await page
		.getByRole('navigation', { name: 'Bereiche' })
		.getByRole('link', { name: 'Kaution' })
		.click();
	await expect(page).toHaveURL(`${leaseUrl}/kaution`);
	await expect(page.getByRole('list', { name: 'Raten' }).getByRole('listitem')).toHaveCount(3);
	await expect(page.getByText('Noch keine Bewegungen.')).toBeVisible();
	await page.getByLabel('Betrag').fill('600,00');
	await page.getByLabel('Notiz (optional)').fill('erste Rate');
	await page.getByRole('button', { name: 'Bewegung buchen' }).click();
	const movements = page.getByRole('table', { name: 'Kautionsbewegungen' });
	await expect(movements.getByRole('row')).toHaveCount(2);
	await expect(movements).toContainText('Erhalten');
	await expect(movements).toContainText('erste Rate');
	await expect(movements).toContainText(/\+600,00\s€/);
	const summary = page.getByLabel('Zusammenfassung');
	await expect(summary).toContainText(/1\.200,00\s€/);
	await expect(page.getByRole('list', { name: 'Raten' })).toBeVisible();

	// The lease now carries money, so it cannot be deleted, only ended.
	await page.goto(leaseUrl);
	await page.getByRole('button', { name: 'Mietvertrag löschen' }).click();
	await expect(page.getByRole('alert')).toContainText('Vertrag beenden');

	// Vertrag beenden: a tenant's notice received on 2 March 2026 ends the lease on 31 May 2026
	// (§ 573c BGB); the three follow-up deadlines appear.
	await page.getByLabel('Kündigung erhalten am').fill('2026-03-02');
	await page.locator('select[name="terminatedBy"]').selectOption('tenant');
	await page.getByLabel('Vertragsende', { exact: true }).fill('2026-05-31');
	await page.getByRole('button', { name: 'Vertrag beenden' }).click();
	const notice = page.getByLabel('Kündigung', { exact: true });
	await expect(notice).toContainText('02.03.2026 durch Mieter');
	await expect(notice).toContainText('31.05.2026');
	const deadlines = page.getByRole('list', { name: 'Fristen' });
	await expect(deadlines).toContainText('Zählerstände ablesen am 31.05.2026');
	await expect(deadlines).toContainText('Kaution abrechnen bis 30.11.2026');
	await expect(deadlines).toContainText('Betriebskostenabrechnung bis 31.12.2027');
	await expect(page.getByRole('button', { name: 'Vertrag beenden' })).toHaveCount(0);

	// The list shows the ended lease after the active ones.
	await page.goto('/vertraege');
	const row = page.getByRole('table', { name: 'Mietverträge' }).getByRole('row', { name: label });
	await expect(row).toContainText('Beendet');
	await expect(row).toContainText('01.01.2025 – 31.05.2026');
	await expect(row).toContainText(/800,00\s€/);
});

test('shows validation errors and the deposit hint', async ({ page }) => {
	const { unitId, tenantId } = await seedUnitAndTenant(page);
	await page.goto(`/vertraege/neu?unitId=${unitId}&tenantId=${tenantId}`);
	await page.getByLabel('Beginn', { exact: true }).fill('2026-02-01');
	await page.getByLabel('Vertragsende (optional)').fill('2026-01-31');
	await page.locator('input[name="baseRent"]').fill('600,00');
	await page.locator('input[name="securityDeposit"]').fill('2.000,00');
	await page.getByRole('button', { name: 'Mietvertrag anlegen' }).click();
	await expect(page.getByText('Das Vertragsende liegt vor dem Beginn.')).toBeVisible();
	await expect(
		page.getByText('Die Kaution übersteigt drei Nettokaltmieten (§ 551 BGB).')
	).toBeVisible();
	await expect(page.locator('input[name="baseRent"]')).toHaveValue('600,00');
});

test('answers unknown leases with 404', async ({ page }) => {
	const response = await page.goto('/vertraege/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
