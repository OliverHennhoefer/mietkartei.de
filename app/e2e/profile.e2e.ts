import { expect, test } from '@playwright/test';
import { closeLaunchNotice } from './launch-notice';
import { owner } from './owner';
import { linkInMailTo, mailTo } from './outbox';
import { pdfText } from './pdf-text';
import { seedLease, seedRows, seedUser, signInAs } from './seed';

// The profile page under /einstellungen/profil: the landlord sender block, which every letter and
// statement prints, and name, address and password. The owner's name, address and password stay
// as they are; the second test changes those of a user of its own.

test('saves the landlord sender block, which the letters print', async ({ page }) => {
	// Reached through the account menu: the settings open as a dialog over the page.
	await page.goto('/objekte');
	// The menu button works only once the page is hydrated, which the map images can delay.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Konto', exact: true }).click();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
	await expect(dialog.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/profil$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Objekte' })).toBeAttached();
	const form = page.locator('form[action="?/landlord"]');

	// An invalid postal code is refused in place, with the values kept.
	await form.getByLabel('Name des Vermieters').fill('Vera Vermieterin');
	await form.getByLabel('Straße und Hausnummer').fill('Lindenstraße 4');
	await form.getByLabel('Postleitzahl').fill('1234');
	await form.getByLabel('Ort').fill('Leipzig');
	await form.getByLabel('IBAN').fill('DE89 3704 0044 0532 0130 00');
	await form.getByLabel('Bank').fill('Commerzbank');
	await form.getByRole('button', { name: 'Absender speichern' }).click();
	await expect(form.getByText('Die Postleitzahl hat fünf Ziffern.')).toBeVisible();
	await expect(form.getByLabel('Straße und Hausnummer')).toHaveValue('Lindenstraße 4');

	await form.getByLabel('Postleitzahl').fill('04109');
	await form.getByRole('button', { name: 'Absender speichern' }).click();
	await expect(page.getByText('Der Absender wurde gespeichert.')).toBeVisible();

	// Stored: the form shows it after a reload, and the log has the change.
	await page.reload();
	await expect(form.getByLabel('Name des Vermieters')).toHaveValue('Vera Vermieterin');
	await expect(form.getByLabel('Postleitzahl')).toHaveValue('04109');
	await expect(form.getByLabel('Ort')).toHaveValue('Leipzig');
	await expect(form.getByLabel('IBAN')).toHaveValue('DE89370400440532013000');
	await expect(form.getByLabel('Bank')).toHaveValue('Commerzbank');
	await page.goto('/einstellungen');
	await page
		.getByRole('navigation', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Protokoll' })
		.click();
	await page.getByLabel('Bereich').selectOption({ label: 'Konto' });
	await expect(page).toHaveURL(/\/einstellungen\/protokoll\?entity=account$/);
	await expect(
		page
			.getByRole('table', { name: 'Protokoll' })
			.getByRole('row', { name: /Absender \(Vermieter\) für Briefe und Abrechnungen geändert/ })
			.first()
	).toContainText(owner.email);

	// An index rent letter (seeded, the rent feature writes it) prints the block as sender and
	// the place in the date line.
	const lease = await seedLease(page.request);
	const {
		ids: [changeId]
	} = await seedRows(page.request, 'rentChanges', [
		{
			leaseId: lease.leaseId,
			validFrom: '2026-03-01',
			baseRent: 62_000,
			reason: 'indexed',
			status: 'approved',
			deliveredOn: '2026-01-10',
			letterText: 'Sehr geehrte Frau Muster,\n\ndie Kaltmiete steigt nach dem Index.',
			letterTable: [['Kaltmiete', '600,00 €', '620,00 €']]
		}
	]);
	const response = await page.request.get(
		`/vertraege/${lease.leaseId}/miethoehe/brief/${changeId}`
	);
	expect(response.status()).toBe(200);
	const text = await pdfText(await response.body());
	for (const line of ['Vera Vermieterin', 'Lindenstraße 4', '04109 Leipzig']) {
		expect(text).toContain(line);
	}
	expect(text).toContain('Leipzig, 10.01.2026');
});

test('changes the name, the password and the address, which sign out the other browsers', async ({
	browser,
	baseURL
}) => {
	// A user of its own in two browsers of its own, because the change ends the other sessions.
	const user = {
		email: `profil-${crypto.randomUUID().slice(0, 6)}@example.org`,
		password: 'altes-passwort-123',
		newPassword: 'neues-passwort-456'
	};
	const signedOut = { storageState: { cookies: [], origins: [] } };
	const context = await browser.newContext(signedOut);
	const other = await browser.newContext(signedOut);
	const { id } = await seedUser(context.request, {
		email: user.email,
		password: user.password,
		role: 'manager'
	});
	await signInAs(context, id, baseURL!);
	await signInAs(other, id, baseURL!);
	const page = await context.newPage();
	const otherPage = await other.newPage();
	await closeLaunchNotice(otherPage);

	await page.goto('/einstellungen/profil');
	const profile = page.locator('form[action="?/profile"]');
	await profile.getByLabel('Name').fill('Paula Profil');
	await profile.getByRole('button', { name: 'Profil speichern' }).click();
	await expect(page.getByText('Dein Profil wurde gespeichert.')).toBeVisible();
	await page.reload();
	// The account button shows the new initials.
	await expect(
		page.getByRole('button', { name: 'Konto', exact: true }).locator('.avatar')
	).toHaveText('PP');

	// A new address needs the current password.
	await profile.getByLabel('E-Mail-Adresse', { exact: true }).fill(`neu-${user.email}`);
	await profile.getByRole('button', { name: 'Profil speichern' }).click();
	await expect(
		profile.getByText('Zum Ändern der E-Mail-Adresse brauchen wir dein Passwort.')
	).toBeVisible();
	await page.reload();

	const password = page.locator('form[action="?/password"]');
	await password.getByLabel('Aktuelles Passwort').fill('falsches-passwort');
	await password.locator('input[name="password"]').fill(user.newPassword);
	await password.getByLabel('Neues Passwort wiederholen').fill(user.newPassword);
	await password.getByRole('button', { name: 'Passwort ändern' }).click();
	await expect(password.getByText('Das aktuelle Passwort stimmt nicht.')).toBeVisible();
	await password.getByLabel('Aktuelles Passwort').fill(user.password);
	await password.locator('input[name="password"]').fill(user.newPassword);
	await password.getByLabel('Neues Passwort wiederholen').fill(user.newPassword);
	await password.getByRole('button', { name: 'Passwort ändern' }).click();
	await expect(page.getByText('Auf anderen Geräten bist du jetzt abgemeldet.')).toBeVisible();

	// This browser stays signed in, the other one is signed out.
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/objekte$/);
	await otherPage.goto('/objekte');
	await expect(otherPage).toHaveURL(/\/anmelden$/);

	// The new password signs in (that the old one no longer does, the unit tests check).
	await otherPage.getByLabel('E-Mail-Adresse').fill(user.email);
	await otherPage.getByLabel('Passwort').fill(user.newPassword);
	await otherPage.getByRole('button', { name: 'Anmelden' }).click();
	await expect(otherPage).toHaveURL(/\/aufgaben$/);

	// A new address counts only once the link mailed to it is used; the old address is told.
	const newEmail = `neu-${user.email}`;
	await page.goto('/einstellungen/profil');
	await profile.getByLabel('E-Mail-Adresse', { exact: true }).fill(newEmail);
	await profile.getByLabel('Aktuelles Passwort').fill(user.newPassword);
	await profile.getByRole('button', { name: 'Profil speichern' }).click();
	await expect(page.getByText(`Wir haben dir einen Link an ${newEmail} geschickt.`)).toBeVisible();
	expect((await mailTo(page.request, user.email)).text).toContain(newEmail);
	const link = await linkInMailTo(page.request, newEmail, '/e-mail-bestaetigen/');
	await page.reload();
	await expect(profile.getByLabel('E-Mail-Adresse', { exact: true })).toHaveValue(user.email);

	await page.goto(link);
	await expect(page.getByText(`Bestätige, dass ${newEmail} ab jetzt`)).toBeVisible();
	await page.getByRole('button', { name: 'E-Mail-Adresse bestätigen' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/profil$/);
	await expect(profile.getByLabel('E-Mail-Adresse', { exact: true })).toHaveValue(newEmail);
	// The other browser is signed out, and the link is used up.
	await otherPage.goto('/objekte');
	await expect(otherPage).toHaveURL(/\/anmelden$/);
	expect((await page.request.get(link)).status()).toBe(404);
	await context.close();
	await other.close();
});
