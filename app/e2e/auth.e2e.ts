import { expect, test } from '@playwright/test';
import { linkInMailTo, readOutbox } from './outbox';
import { owner } from './owner';
import { seedRows, seedUser } from './seed';

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

// The hosted variant lets only the addresses of REGISTRATION_EMAILS register (playwright.config.ts
// lists the owner); a self-hosted instance only its first person.
const hosted = process.env.DEPLOY_TARGET === 'cloudflare';

test('closes registration after the first user on a self-hosted instance', async ({ page }) => {
	test.skip(hosted, 'The hosted variant registers listed addresses only.');
	await page.goto('/registrieren');
	await expect(
		page.getByText('Auf dieser Instanz können sich keine weiteren Personen registrieren.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Konto anlegen' })).toHaveCount(0);
});

test('refuses an address that is not listed on the hosted variant', async ({ page }) => {
	test.skip(!hosted, 'Self-hosted instances have no list.');
	await page.goto('/registrieren');
	await expect(page.getByText('mietkartei ist noch nicht öffentlich.')).toBeVisible();
	await page.getByLabel('E-Mail-Adresse').fill('fremd@example.org');
	await page.getByLabel('Passwort').fill('noch-ein-sicheres-passwort');
	await page.getByRole('button', { name: 'Konto anlegen' }).click();

	await expect(
		page.getByText('Diese E-Mail-Adresse ist nicht für eine Registrierung freigeschaltet.')
	).toBeVisible();
	await expect(page).toHaveURL(/\/registrieren$/);
});

test('offers no registration link on the sign-in page', async ({ page }) => {
	await page.goto('/anmelden');
	await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCount(0);
});

test('sends the security headers and a CSP with a nonce', async ({ request }) => {
	const response = await request.get('/anmelden');
	const headers = response.headers();
	const csp = headers['content-security-policy'];
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("form-action 'self'");
	expect(csp).toMatch(/script-src 'self'[^;]* 'nonce-[^']+'/);
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('same-origin');
	expect(headers['x-content-type-options']).toBe('nosniff');
});

test('resets the password through the link from the mail', async ({ page }) => {
	// A user of its own: the reset ends every session of the user, and the signed-in projects
	// keep using the owner's.
	const user = {
		email: `zuruecksetzen-${crypto.randomUUID().slice(0, 6)}@example.org`,
		password: 'altes-passwort-123',
		newPassword: 'neues-passwort-456'
	};
	await seedUser(page.request, { email: user.email, password: user.password, role: 'manager' });

	await page.goto('/anmelden');
	await page.getByRole('link', { name: 'Passwort vergessen?' }).click();
	await expect(page).toHaveURL(/\/passwort-vergessen$/);
	await page.getByLabel('E-Mail-Adresse').fill(user.email);
	await page.getByRole('button', { name: 'Link anfordern' }).click();
	await expect(page.getByRole('status')).toContainText('haben wir dir eine E-Mail');

	const link = await linkInMailTo(page.request, user.email, '/passwort-zuruecksetzen/');
	expect(new URL(link).origin).toBe(new URL(page.url()).origin);

	await page.goto(link);
	await expect(page.getByRole('heading', { level: 1, name: 'Neues Passwort' })).toBeVisible();
	// The label of the password field carries the length hint, so the field goes by its name.
	await page.locator('input[name="password"]').fill(user.newPassword);
	await page.locator('input[name="passwordConfirm"]').fill(user.newPassword);
	await page.getByRole('button', { name: 'Passwort setzen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation')).toContainText(user.email);

	// The link is used up.
	const response = await page.request.get(link);
	expect(response.status()).toBe(404);

	// The new password signs in (that the old one no longer does, the unit tests check).
	await page.getByRole('button', { name: 'Abmelden' }).click();
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(user.email);
	await page.getByLabel('Passwort').fill(user.newPassword);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('sends no reset link to a host named by the request', async ({ page, baseURL }) => {
	// On node without ORIGIN the Host header names the app. A request that claims another host
	// (with a matching Origin, so the CSRF check passes) must not put that host into the mail.
	// On Workers the host is the one Cloudflare routed, so the case does not arise there.
	test.skip(hosted, 'node only');
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
	expect((await readOutbox(page.request)).some((mail) => mail.to === email)).toBe(false);
});

test('locks an address after five wrong passwords', async ({ page }) => {
	// Four failures are seeded, so the test spends one sign-in of the rate limit, not five.
	const email = `gesperrt-${crypto.randomUUID().slice(0, 6)}@example.org`;
	await seedRows(page.request, 'loginAttempts', [
		{ email, failures: 4, firstFailureAt: Date.now() }
	]);
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(email);
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'Zu viele Fehlversuche. Bitte warte 15 Minuten.'
	);
});

test('answers unknown reset, invitation and registration links with 404', async ({ page }) => {
	const reset = await page.goto('/passwort-zuruecksetzen/does-not-exist');
	expect(reset?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
	const invitation = await page.goto('/einladung/does-not-exist');
	expect(invitation?.status()).toBe(404);
	const registration = await page.goto('/registrieren/does-not-exist');
	expect(registration?.status()).toBe(404);
});
