import { expect, test, type APIRequestContext } from '@playwright/test';
import { owner } from './owner';
import { seedUser } from './seed';

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
	// A user of its own: the reset ends every session of the user, and the signed-in projects
	// keep using the owner's.
	const user = {
		email: `zuruecksetzen-${crypto.randomUUID().slice(0, 6)}@example.org`,
		password: 'altes-passwort-123',
		newPassword: 'neues-passwort-456'
	};
	await seedUser(page.request, { email: user.email, password: user.password, role: 'manager' });

	await page.goto('/passwort-vergessen');
	await page.getByLabel('E-Mail-Adresse').fill(user.email);
	await page.getByRole('button', { name: 'Link anfordern' }).click();
	await expect(page.getByRole('status')).toContainText('haben wir dir eine E-Mail');

	const mail = await mailTo(page.request, user.email, /Passwort/);
	const link = mail.text.match(/https?:\/\/\S+\/passwort-zuruecksetzen\/[A-Za-z0-9_-]+/)?.[0];
	expect(link).toBeDefined();
	expect(new URL(link!).origin).toBe(new URL(page.url()).origin);

	await page.goto(link!);
	await expect(page.getByRole('heading', { level: 1, name: 'Neues Passwort' })).toBeVisible();
	// The label of the password field carries the length hint, so the field goes by its name.
	await page.locator('input[name="password"]').fill(user.newPassword);
	await page.locator('input[name="passwordConfirm"]').fill(user.newPassword);
	await page.getByRole('button', { name: 'Passwort setzen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation')).toContainText(user.email);

	// The link is used up.
	const response = await page.request.get(link!);
	expect(response.status()).toBe(404);

	// The new password signs in, the old one no longer does.
	await page.getByRole('button', { name: 'Abmelden' }).click();
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(user.email);
	await page.getByLabel('Passwort').fill(user.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page.getByRole('alert')).toHaveText('E-Mail-Adresse oder Passwort stimmen nicht.');
	await page.getByLabel('Passwort').fill(user.newPassword);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('sends no reset link to a host named by the request', async ({ page, baseURL }) => {
	// On node without ORIGIN the Host header names the app. A request that claims another host
	// (with a matching Origin, so the CSRF check passes) must not put that host into the mail.
	// On Workers the host is the one Cloudflare routed, so the case does not arise there.
	test.skip(process.env.DEPLOY_TARGET === 'cloudflare', 'node only');
	const email = `fremd-${crypto.randomUUID().slice(0, 6)}@example.org`;
	await seedUser(page.request, { email, password: 'irgendein-passwort', role: 'manager' });
	const port = new URL(baseURL!).port;
	const response = await page.request.post('/passwort-vergessen', {
		form: { email },
		headers: {
			host: `evil.example:${port}`,
			origin: `http://evil.example:${port}`,
			'x-sveltekit-action': 'true'
		}
	});
	expect(response.status()).toBe(503);
	expect(JSON.stringify(await response.json())).toContain('ORIGIN');
	const outbox = (await (await page.request.get('/__e2e/outbox')).json()) as { to: string }[];
	expect(outbox.some((mail) => mail.to === email)).toBe(false);
});

test('changes the name and the password on the profile page', async ({ page, browser }) => {
	// A user of its own, because the change ends the user's other sessions.
	const user = {
		email: `profil-${crypto.randomUUID().slice(0, 6)}@example.org`,
		password: 'altes-passwort-123',
		newPassword: 'neues-passwort-456'
	};
	await seedUser(page.request, { email: user.email, password: user.password, role: 'manager' });
	async function signIn(target: typeof page, password: string) {
		await target.goto('/anmelden');
		await target.getByLabel('E-Mail-Adresse').fill(user.email);
		await target.getByLabel('Passwort').fill(password);
		await target.getByRole('button', { name: 'Anmelden' }).click();
	}
	await signIn(page, user.password);
	await expect(page).toHaveURL(/\/$/);
	// A second browser of the same user, which the password change signs out.
	const other = await browser.newContext();
	const otherPage = await other.newPage();
	await signIn(otherPage, user.password);
	await expect(otherPage).toHaveURL(/\/$/);

	await page.goto('/einstellungen/profil');
	const profile = page.locator('form[action="?/profile"]');
	await profile.getByLabel('Name').fill('Paula Profil');
	await profile.getByRole('button', { name: 'Profil speichern' }).click();
	await expect(page.getByText('Dein Profil wurde gespeichert.')).toBeVisible();
	await page.reload();
	await expect(page.getByRole('navigation')).toContainText('Paula Profil');

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
	await other.close();

	// The new password signs in, the old one no longer does.
	await page.getByRole('button', { name: 'Abmelden' }).click();
	await signIn(page, user.password);
	await expect(page.getByRole('alert')).toHaveText('E-Mail-Adresse oder Passwort stimmen nicht.');
	await signIn(page, user.newPassword);
	await expect(page).toHaveURL(/\/$/);
});

test('locks an address after five wrong passwords', async ({ page }) => {
	const email = `gesperrt-${crypto.randomUUID().slice(0, 6)}@example.org`;
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
