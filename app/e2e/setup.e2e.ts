import { expect, test } from '@playwright/test';
import { owner } from './owner';

test('the first visitor registers and becomes the owner', async ({ page }) => {
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
	await page.context().storageState({ path: '.e2e/owner.json' });
});
