import { expect, test, type APIRequestContext } from '@playwright/test';
import { owner } from './owner';

test('health check works without signing in', async ({ request }) => {
	const response = await request.get('/health');
	expect(response.ok()).toBe(true);
	expect(await response.json()).toEqual({ status: 'ok' });
});

test('redirects to the sign-in page when signed out', async ({ page }) => {
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/anmelden$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeVisible();
});

test('rejects a wrong password', async ({ page }) => {
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Anmelden' }).click();

	await expect(page.getByRole('alert')).toHaveText('E-Mail-Adresse oder Passwort stimmen nicht.');
	await expect(page).toHaveURL(/\/anmelden$/);
});

test('signs in and out', async ({ page }) => {
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/$/);

	await page.getByRole('button', { name: 'Abmelden' }).click();
	await expect(page).toHaveURL(/\/anmelden$/);
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/anmelden$/);
});

test('closes registration after the first user on a self-hosted instance', async ({ page }) => {
	await page.goto('/registrieren');
	await expect(
		page.getByText('Auf dieser Instanz können sich keine weiteren Personen registrieren.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Konto anlegen' })).toHaveCount(0);
});

/** The newest mail in the outbox sent to the address whose subject matches. */
async function mailTo(request: APIRequestContext, to: string, subject: RegExp) {
	const response = await request.get('/__e2e/outbox');
	expect(response.ok()).toBe(true);
	const mails = (await response.json()) as { to: string; subject: string; text: string }[];
	const mail = mails.find((candidate) => candidate.to === to && subject.test(candidate.subject));
	expect(mail, `a mail to ${to}`).toBeDefined();
	return mail!;
}

test('resets the password through the link from the mail', async ({ page }) => {
	await page.goto('/passwort-vergessen');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByRole('button', { name: 'Link anfordern' }).click();
	await expect(page.getByRole('status')).toContainText('haben wir dir eine E-Mail');

	const mail = await mailTo(page.request, owner.email, /Passwort/);
	const link = mail.text.match(/https?:\/\/\S+\/passwort-zuruecksetzen\/[A-Za-z0-9_-]+/)?.[0];
	expect(link).toBeDefined();

	// The same password again, so the owner stays usable for every other test.
	await page.goto(link!);
	await expect(page.getByRole('heading', { level: 1, name: 'Neues Passwort' })).toBeVisible();
	// The label of the password field carries the length hint, so the field goes by its name.
	await page.locator('input[name="password"]').fill(owner.password);
	await page.locator('input[name="passwordConfirm"]').fill(owner.password);
	await page.getByRole('button', { name: 'Passwort setzen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation')).toContainText(owner.email);

	// The link is used up.
	const response = await page.request.get(link!);
	expect(response.status()).toBe(404);

	await page.getByRole('button', { name: 'Abmelden' }).click();
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/$/);
	// The reset ended every session of the owner, including the one the signed-in projects
	// use; this fresh one takes its place.
	await page.context().storageState({ path: '.e2e/owner.json' });
});

test('locks an address after five wrong passwords', async ({ page }) => {
	const email = `gesperrt-${Math.random().toString(36).slice(2, 8)}@example.org`;
	for (let attempt = 1; attempt <= 6; attempt++) {
		await page.goto('/anmelden');
		await page.getByLabel('E-Mail-Adresse').fill(email);
		await page.getByLabel('Passwort').fill('falsches-passwort');
		await page.getByRole('button', { name: 'Anmelden' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
	}
	await expect(page.getByRole('alert')).toHaveText(
		'Zu viele Fehlversuche. Bitte warte 15 Minuten.'
	);
});

test('answers unknown reset and invitation links with 404', async ({ page }) => {
	const reset = await page.goto('/passwort-zuruecksetzen/does-not-exist');
	expect(reset?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
	const invitation = await page.goto('/einladung/does-not-exist');
	expect(invitation?.status()).toBe(404);
});
