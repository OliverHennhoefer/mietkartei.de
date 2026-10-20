import { expect, test } from '@playwright/test';
import { pdfText } from './pdf-text';
import { seedLease, seedRows } from './seed';

// One property with one apartment of 72,5 m² rented all of 2025 at 150 + 50 € prepayments, a
// Grundsteuer of 3.000 € by area and 500 € of non-allocable administration: the tenant carries
// the whole 3.000 € against 12 × 200 € = 2.400 € prepayments, a Nachzahlung of 600 €.
test('creates, approves, prints and corrects a statement', async ({ page }) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	const { propertyId, leaseId } = await seedLease(page.request, {
		unit: { name: `Wohnung EG ${suffix}`, floorArea: 72.5 },
		lease: { startDate: '2025-01-01', persons: 2 }
	});
	const {
		ids: [categoryId]
	} = await seedRows(page.request, 'costCategories', [
		{ name: `Grundsteuer ${suffix}`, betrkvItem: 1, allocable: true, allocationKeyId: null }
	]);
	const {
		ids: [keyId]
	} = await seedRows(page.request, 'allocationKeys', [
		{ name: `Wohnfläche ${suffix}`, kind: 'area' }
	]);
	await seedRows(page.request, 'costItems', [
		{
			propertyId,
			categoryId,
			allocationKeyId: keyId,
			description: `Grundsteuer 2025 ${suffix}`,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 300000,
			allocable: true
		},
		{
			propertyId,
			categoryId,
			allocationKeyId: keyId,
			description: `Hausverwaltung ${suffix}`,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 50000,
			allocable: false
		}
	]);

	// The draft.
	await page.goto('/betriebskosten');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betriebskosten');
	await page.getByLabel('Objekt').selectOption({ value: propertyId });
	await page.getByLabel('Zeitraum von').fill('2025-01-01');
	await page.getByLabel('Zeitraum bis').fill('2025-12-31');
	await page.getByRole('button', { name: 'Entwurf erstellen' }).click();
	await expect(page).toHaveURL(/\/betriebskosten\/abrechnungen\/[0-9a-f-]{36}$/);
	const statementId = page.url().split('/').pop()!;
	await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
	await expect(page.locator('.stats')).toContainText('Gesamtkosten');

	const lease = page.getByRole('region', { name: `Mietvertrag Wohnung EG ${suffix}` });
	await expect(lease).toContainText('72,5 m² von 72,5 m² · 365 von 365 Tagen');
	await expect(lease).toContainText('3.000,00 €');
	await expect(lease).toContainText('Vorauszahlungen 2.400,00 €');
	await expect(lease).toContainText('Nachzahlung 600,00 €');
	// The non-allocable item is listed, but not allocated.
	await expect(page.getByRole('table', { name: 'Belege' })).toContainText('nicht umlagefähig');

	// The approval.
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: /^Freigeben: 1 Mietvertrag/ }).click();
	await expect(page.getByText('Freigegeben', { exact: true })).toBeVisible();
	await expect(page.getByText('auf den Mietkonten gebucht')).toBeVisible();
	await expect(lease.getByRole('link', { name: 'PDF' })).toHaveAttribute(
		'href',
		`/betriebskosten/abrechnungen/${statementId}/pdf/${leaseId}`
	);
	await expect(lease.getByRole('link', { name: 'Vorauszahlung anpassen' })).toHaveAttribute(
		'href',
		`/vertraege/${leaseId}/miethoehe?prepayment=25000`
	);

	// The PDF from the frozen result.
	const response = await page.request.get(
		`/betriebskosten/abrechnungen/${statementId}/pdf/${leaseId}`
	);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/pdf');
	expect(response.headers()['content-disposition']).toContain('Betriebskostenabrechnung 2025');
	const text = await pdfText(await response.body());
	expect(text).toContain('Betriebskostenabrechnung 2025');
	expect(text).toContain('Gesamtkosten');
	expect(text).toContain('Umlageschlüssel');
	expect(text).toContain('Dein Anteil');
	expect(text).toContain('Vorauszahlungen');
	expect(text).toContain('3.000,00 €');
	expect(text).toContain('2.400,00 €');
	expect(text).toContain('Nachzahlung 600,00 €');
	// The draft's PDF route answers 404 for a lease that is not part of the statement.
	const foreign = await page.request.get(
		`/betriebskosten/abrechnungen/${statementId}/pdf/does-not-exist`
	);
	expect(foreign.status()).toBe(404);

	// The delivery date starts the Einwendungsfrist.
	await lease.getByLabel(`zugestellt am Wohnung EG ${suffix}`).fill('2026-03-02');
	await lease.getByRole('button', { name: 'Speichern' }).click();
	await expect(lease).toContainText('Einwendungsfrist bis 02.03.2027');

	// The correction is a new draft version.
	await page.getByRole('button', { name: 'Korrektur erstellen' }).click();
	// The action redirects to the new draft; wait until the old id has left the URL.
	await expect(page).not.toHaveURL(`/betriebskosten/abrechnungen/${statementId}`);
	await expect(page).toHaveURL(/\/betriebskosten\/abrechnungen\/[0-9a-f-]{36}$/);
	await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
	await expect(page.getByText('Version 2')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Version 1' })).toHaveAttribute(
		'href',
		`/betriebskosten/abrechnungen/${statementId}`
	);

	// The list shows both versions.
	await page.goto('/betriebskosten');
	const list = page.getByRole('table', { name: /^Abrechnungen Testhaus/ }).filter({
		hasText: '3.500,00 €'
	});
	await expect(list.getByRole('row')).toHaveCount(3);
});

test('answers unknown statements with 404', async ({ page }) => {
	const response = await page.goto('/betriebskosten/abrechnungen/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
