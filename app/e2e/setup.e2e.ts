import { expect, test } from '@playwright/test';
import { watchCspViolations } from './csp';
import { owner } from './owner';
import { clearTables, seedRows } from './seed';

test('the first visitor registers and becomes the owner', async ({ page }) => {
	// The only run of the open registration form, so it is also checked against the CSP.
	const violations = watchCspViolations(page);
	await page.goto('/');
	await expect(page).toHaveURL(/\/registrieren$/);

	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto anlegen' }).click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation')).toContainText(owner.email);

	// The empty account gets the first steps instead of the tiles, each linked to its form.
	const steps = page.getByRole('region', { name: 'Erste Schritte' });
	await expect(steps).toContainText('Dein Bestand ist noch leer.');
	await expect(page.getByRole('list', { name: 'Kennzahlen' })).toHaveCount(0);
	for (const [name, href] of [
		['Objekt anlegen', '/objekte/neu'],
		['Einheit anlegen', '/objekte/neu'],
		['Mieter anlegen', '/mieter/neu'],
		['Mietvertrag mit Miete und Kaution anlegen', '/vertraege/neu'],
		['Bankverbindung für den Umsatzabgleich anlegen', '/bank/konten'],
		['Kostenarten und Umlageschlüssel prüfen', '/betriebskosten/kostenarten']
	]) {
		await expect(steps.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
	}
	await expect(steps).not.toContainText('erledigt');

	// With a property but no lease and no bank account it stays, the property ticked off and the
	// unit step pointing to the property's page with the unit form.
	const {
		ids: [propertyId]
	} = await seedRows(page.request, 'properties', [
		{ name: 'Erstes Haus', street: 'Anfangsweg 1', postalCode: '10115', city: 'Berlin' }
	]);
	await page.reload();
	await expect(page.getByRole('list', { name: 'Kennzahlen' })).toHaveCount(0);
	const items = steps.locator('ol > li');
	await expect(items.nth(0)).toContainText('erledigt');
	await expect(items.nth(1)).not.toContainText('erledigt');
	await expect(steps.getByRole('link', { name: 'Einheit anlegen', exact: true })).toHaveAttribute(
		'href',
		`/objekte/${propertyId}`
	);
	await clearTables(page.request, ['properties']);
	await page.context().storageState({ path: '.e2e/owner.json' });
	expect(violations).toEqual([]);
});
