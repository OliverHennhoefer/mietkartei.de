import { expect, test } from '@playwright/test';
import { watchCspViolations } from './csp';
import { linkInMailTo } from './outbox';
import { owner } from './owner';
import { clearTables, seedRows } from './seed';

test('the first visitor registers and becomes the owner', async ({ page, request }) => {
	// The only run of the open registration form (and on the hosted variant of the page of its
	// link), so it is also checked against the CSP.
	const violations = watchCspViolations(page);
	await page.goto('/');
	await expect(page).toHaveURL(/\/registrieren$/);

	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	if (process.env.DEPLOY_TARGET === 'cloudflare') {
		// The hosted variant lists the owner in REGISTRATION_EMAILS. A listed address asks for a
		// link here and chooses the password on the page the mail leads to.
		await page.getByRole('button', { name: 'Link anfordern' }).click();
		await expect(page.getByRole('status')).toContainText('E-Mail mit einem Link');
		const link = await linkInMailTo(page.request, owner.email, '/registrieren/');
		await page.goto(link);
		await expect(page.getByText(`Konto mit ${owner.email}`)).toBeVisible();
		await page.locator('input[name="password"]').fill(owner.password);
		await page.locator('input[name="passwordConfirm"]').fill(owner.password);
		await page.getByRole('button', { name: 'Konto anlegen' }).click();
		await expect(page).toHaveURL(/\/$/);
		// The link is used up (asked signed out: a signed-in visit is sent to the start page).
		expect((await request.get(link)).status()).toBe(404);
	} else {
		await page.getByLabel('Passwort').fill(owner.password);
		await page.getByRole('button', { name: 'Konto anlegen' }).click();
	}

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
	// The owner of an empty account may try the demo data; the import is linked as well, also
	// from the empty lists of properties and tenants.
	await expect(steps.getByRole('link', { name: 'Demodaten' })).toHaveAttribute(
		'href',
		'/einstellungen/konto'
	);
	await expect(steps.getByRole('link', { name: 'Datenübernahme' })).toHaveAttribute(
		'href',
		'/datenuebernahme'
	);
	await page.goto('/objekte');
	await expect(
		page.getByRole('link', { name: 'Daten aus einer anderen Software importieren' })
	).toHaveAttribute('href', '/datenuebernahme');
	await page.goto('/mieter');
	await expect(page.getByRole('link', { name: 'Importieren' })).toHaveAttribute(
		'href',
		'/datenuebernahme'
	);
	await page.goto('/');

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
	// Demo data only goes into an account without any property.
	await expect(steps.getByRole('link', { name: 'Demodaten' })).toHaveCount(0);
	await expect(steps.getByRole('link', { name: 'Einheit anlegen', exact: true })).toHaveAttribute(
		'href',
		`/objekte/${propertyId}`
	);
	await clearTables(page.request, ['properties']);
	await page.context().storageState({ path: '.e2e/owner.json' });
	expect(violations).toEqual([]);
});
