import { expect, test } from '@playwright/test';
import { seedLease } from './seed';

// Tenants: create, edit, list, archive and delete. The lease that blocks a delete is seeded, not clicked
// together, so this file drives only the tenant pages.

const suffix = () => crypto.randomUUID().slice(0, 6);

test('creates a tenant, edits it and finds it in the list', async ({ page }) => {
	const lastName = `Testmieter-${suffix()}`;
	await page.goto('/mieter/neu');
	await page.getByLabel('Vorname').fill('Max');
	await page.getByLabel('Nachname').fill(lastName);
	await page.getByLabel('E-Mail-Adresse (optional)').fill('max@example.org');
	await page.getByLabel('Postleitzahl (optional)').fill('10115');
	await page.getByLabel('Ort (optional)').fill('Berlin');
	await page.getByRole('button', { name: 'Mieter anlegen' }).click();

	await expect(page).toHaveURL(/\/mieter\/[^/]+$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Max ${lastName}`);
	await expect(page.getByRole('link', { name: 'max@example.org' })).toBeVisible();
	await expect(page.getByText('Dieser Mieter steht auf keinem Mietvertrag.')).toBeVisible();

	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	await expect(page.getByLabel('Nachname')).toHaveValue(lastName);
	await page.getByLabel('Telefon (optional)').fill('030 1234567');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Max ${lastName}`);
	await expect(page.getByText('030 1234567')).toBeVisible();

	// The list shows the contact; the search still finds the tenant by their address.
	await page.goto('/mieter');
	await page.getByRole('searchbox', { name: 'Mieter durchsuchen' }).fill('10115 Berlin');
	const table = page.getByRole('table', { name: 'Mieter' });
	const row = table.getByRole('row').filter({ hasText: lastName });
	await expect(row).toContainText('max@example.org');
	await expect(row).toContainText('keine');
});

test('shows validation errors next to the fields', async ({ page }) => {
	await page.goto('/mieter/neu');
	await page.getByLabel('Vorname').fill('Max');
	await page.getByLabel('Nachname').fill('Fehler');
	await page.getByLabel('Postleitzahl (optional)').fill('123');
	await page.getByRole('button', { name: 'Mieter anlegen' }).click();
	await expect(page.getByText('Die Postleitzahl hat fünf Ziffern.')).toBeVisible();
	await expect(page.getByLabel('Nachname')).toHaveValue('Fehler');
});

test('comes back to the lease form with the new tenant preselected', async ({ page }) => {
	await page.goto('/mieter/neu?return=/vertraege/neu');
	await page.getByLabel('Vorname').fill('Rück');
	await page.getByLabel('Nachname').fill(`Kehr-${suffix()}`);
	await page.getByRole('button', { name: 'Mieter anlegen' }).click();
	await expect(page).toHaveURL(/\/vertraege\/neu\?tenantId=[^&]+$/);
});

test('keeps a tenant on a lease and names the lease instead of offering to delete', async ({
	page
}) => {
	const lastName = `Gebunden-${suffix()}`;
	const { tenantId } = await seedLease(page.request, { tenant: { lastName } });

	await page.goto(`/mieter/${tenantId}`);
	const leases = page.getByRole('list', { name: 'Mietverträge' });
	await expect(leases.getByRole('listitem')).toHaveCount(1);
	await expect(leases).toContainText('seit 01.01.2025');
	await expect(leases).toContainText('Aktiv');
	await expect(page.getByText('Warmmiete im Monat')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Finanzen' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Verlauf' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Dokumente dieses Mieters' })).toHaveAttribute(
		'href',
		`/dokumente?tenantId=${tenantId}`
	);

	await expect(page.getByText('Der Mieter steht auf einem Mietvertrag')).toBeVisible();
	await expect(
		page.getByRole('list', { name: 'Was das Löschen verhindert' }).getByRole('link')
	).toHaveAttribute('href', /\/vertraege\/[^/]+$/);
	await expect(page.getByRole('button', { name: 'Mieter löschen' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Mieter archivieren' })).toHaveCount(0);
	await expect(
		page.getByRole('list', { name: 'Was das Archivieren verhindert' }).getByRole('link')
	).toHaveAttribute('href', /\/vertraege\/[^/]+$/);

	await page.goto('/mieter');
	const row = page.getByRole('table', { name: 'Mieter' }).getByRole('row', { name: lastName });
	await expect(row.getByRole('link').nth(1)).toHaveAttribute('href', /\/vertraege\/[^/]+$/);
});

test('deletes a tenant without a lease', async ({ page }) => {
	const lastName = `Frei-${suffix()}`;
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/mieter/neu');
	await page.getByLabel('Vorname').fill('Frida');
	await page.getByLabel('Nachname').fill(lastName);
	await page.getByRole('button', { name: 'Mieter anlegen' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Frida ${lastName}`);

	await page.getByRole('button', { name: 'Mieter löschen' }).click();
	await expect(page).toHaveURL(/\/mieter$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mieter');
	await expect(page.getByText(lastName)).toHaveCount(0);
});

test('archives a tenant without a running lease and brings them back', async ({ page }) => {
	const lastName = `Ausgezogen-${suffix()}`;
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/mieter/neu');
	await page.getByLabel('Vorname').fill('Anna');
	await page.getByLabel('Nachname').fill(lastName);
	await page.getByRole('button', { name: 'Mieter anlegen' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Anna ${lastName}`);

	await page.getByRole('button', { name: 'Mieter archivieren' }).click();
	await expect(page).toHaveURL(/\/mieter$/);
	await expect(page.getByRole('table', { name: 'Mieter' })).not.toContainText(lastName);
	await page.getByText(/^Archiviert \(\d+\)$/).click();
	await page
		.getByRole('list', { name: 'Archivierte Mieter' })
		.getByRole('link', { name: `Anna ${lastName}` })
		.click();
	await expect(page.getByText(/^Archiviert am \d{2}\.\d{2}\.\d{4}\.$/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Mietvertrag anlegen' })).toHaveCount(0);

	await page.getByRole('button', { name: 'Aus dem Archiv holen' }).click();
	await expect(page.getByRole('button', { name: 'Mieter archivieren' })).toBeVisible();
	await page.goto('/mieter');
	await expect(page.getByRole('table', { name: 'Mieter' })).toContainText(lastName);
});

test('answers unknown tenants with 404', async ({ page }) => {
	const response = await page.goto('/mieter/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
