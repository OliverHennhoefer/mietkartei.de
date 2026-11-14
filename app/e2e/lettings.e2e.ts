import { expect, test } from '@playwright/test';
import { seedLease } from './seed';

// A Neuvermietung from start to lease: the unit whose lease ends shows up as soon free, the
// applicant fills in the Selbstauskunft through the secret link without signing in, and the
// Zusage opens the lease form with the letting's terms and the new tenant.

test('finds the next tenant for a unit and turns the applicant into tenant and lease', async ({
	page,
	browser
}) => {
	const year = new Date().getFullYear();
	const { unitId } = await seedLease(page.request, {
		lease: { endDate: `${year + 1}-01-31` }
	});
	const suffix = crypto.randomUUID().slice(0, 6);
	const lastName = `Bewerberin-${suffix}`;

	await page.goto(`/vermietung/neu?unitId=${unitId}`);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Neuvermietung anlegen' })
	).toBeVisible();
	// The terms start from the lease that ends.
	await expect(page.getByLabel('Kaltmiete in €')).toHaveValue('600,00');
	await expect(page.getByLabel('Frei ab (optional)')).toHaveValue(`${year + 1}-02-01`);
	await page.getByLabel('Kaltmiete in €').fill('650,00');
	await page.getByRole('button', { name: 'Neuvermietung anlegen' }).click();
	await expect(page).toHaveURL(/\/vermietung\/[\w-]+$/);
	const lettingUrl = page.url();

	await page.getByLabel('Vorname', { exact: true }).fill('Miriam');
	await page.getByLabel('Nachname', { exact: true }).fill(lastName);
	await page.getByLabel('E-Mail (optional)').fill('miriam@example.org');
	await page.getByRole('button', { name: 'Interessent eintragen' }).click();
	await expect(page.getByText(`Miriam ${lastName} wurde eingetragen`)).toBeVisible();
	await page.getByRole('link', { name: `Miriam ${lastName}` }).click();

	await page.getByRole('button', { name: 'Link erstellen' }).click();
	const link = await page.getByLabel('Link zur Selbstauskunft').inputValue();
	expect(link).toMatch(/\/selbstauskunft\/[\w-]{43}$/);

	// The applicant opens the link in a browser of their own, without an account.
	const applicant = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const form = await applicant.newPage();
	await form.goto(link);
	await expect(form.getByRole('heading', { name: 'Mieterselbstauskunft' })).toBeVisible();
	await expect(form.getByText('Datenschutzhinweis')).toBeVisible();
	// The landlord's page for a guest: no website frame, only a short credit.
	await expect(form.getByRole('link', { name: 'Anmelden' })).toHaveCount(0);
	// Hosted (the cloudflare run) it names the operator, self-hosted only the software.
	await expect(form.getByText(/(Bereitgestellt|Erstellt) mit/)).toBeVisible();
	await expect(form.getByLabel('Nachname', { exact: true })).toHaveValue(lastName);
	await form.getByLabel('Einziehende Erwachsene').fill('1');
	await form.getByLabel('Monatliches Nettoeinkommen des Haushalts in €').fill('3.000');
	await form.getByLabel('Läuft ein Verbraucherinsolvenzverfahren?').selectOption('nein');
	await form.getByRole('button', { name: 'Selbstauskunft absenden' }).click();
	await expect(form.getByText('Vielen Dank!')).toBeVisible();
	await form.reload();
	await expect(form.getByText('Vielen Dank!')).toBeVisible();
	await applicant.close();

	// Back with the landlord: the answers are in, compared with the rent.
	await page.goto(lettingUrl);
	const row = page.getByRole('row').filter({ hasText: lastName });
	await expect(row).toContainText('Selbstauskunft');
	await expect(row).toContainText('3.000,00');
	// 650 + 150 + 50 € of 3.000 €.
	await expect(row).toContainText('28 %');

	await row.getByRole('link', { name: `Miriam ${lastName}` }).click();
	await page
		.locator('.proofs li')
		.filter({ hasText: 'Ausweis vorgezeigt' })
		.getByRole('button')
		.click();
	await expect(page.locator('.proofs li').filter({ hasText: 'Ausweis vorgezeigt' })).toContainText(
		'vorgelegt am'
	);

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Zusage geben und Mietvertrag anlegen' }).click();
	await expect(page).toHaveURL(/\/vertraege\/neu\?/);
	await expect(page.getByLabel('Kaltmiete', { exact: true })).toHaveValue('650,00');
	await expect(page.getByText(`Miriam ${lastName}`).first()).toBeVisible();
});
