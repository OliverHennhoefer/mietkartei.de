import { expect, test } from '@playwright/test';
import { mailTo } from './outbox';
import { owner } from './owner';

// The Benachrichtigungen: the hour of the Hinweise, a mail channel with a test that lands in the
// outbox and in the history, and removing the channel again; the webhook, folded away; the
// manifest and service worker that let the app show Mitteilungen.

test('sets up Hinweise by mail, tests them and removes the channel', async ({ page, request }) => {
	await page.goto('/einstellungen/benachrichtigungen');
	await expect(page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible();

	await page.getByLabel('Uhrzeit').selectOption('18');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Gespeichert.')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Uhrzeit')).toHaveValue('18');

	await page.getByRole('button', { name: 'Hinweise per E-Mail' }).click();
	const channels = page.getByRole('table', { name: 'Kanäle' });
	await expect(channels.getByRole('cell', { name: owner.email })).toBeVisible();

	await channels.getByRole('button', { name: 'Test senden' }).click();
	await expect(page.getByText('Der Test ist angekommen.')).toBeVisible();
	const mail = await mailTo(request, owner.email);
	expect(mail.subject).toBe('Test: Hinweise zu Fristen | mietkartei');
	await expect(page.getByRole('table', { name: 'Verlauf' }).getByText('Zugestellt')).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await channels.getByRole('button', { name: 'Entfernen' }).click();
	await expect(page.getByText('Der Kanal ist entfernt.')).toBeVisible();
	await expect(page.getByText('Noch kein Kanal eingerichtet.')).toBeVisible();
});

test('keeps the webhook folded away for those who want it', async ({ page }) => {
	await page.goto('/einstellungen/benachrichtigungen');
	const address = page.getByLabel('Adresse');
	await expect(address).toBeHidden();
	await page.getByText('Für Technikfreunde: Webhook').click();
	await address.fill('https://n8n.example.de/webhook/mietkartei');
	await page.getByRole('button', { name: 'Webhook hinzufügen' }).click();
	await expect(page.getByRole('heading', { name: 'Der Schlüssel deines Webhooks' })).toBeVisible();
	const channels = page.getByRole('table', { name: 'Kanäle' });
	await expect(
		channels.getByRole('cell', { name: 'https://n8n.example.de/webhook/mietkartei' })
	).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await channels.getByRole('button', { name: 'Entfernen' }).click();
	await expect(page.getByText('Noch kein Kanal eingerichtet.')).toBeVisible();
});

test('can be added to the home screen, and offers Mitteilungen only with a server key', async ({
	page,
	playwright,
	baseURL
}) => {
	// The browser fetches the manifest without the session cookie.
	const anonymous = await playwright.request.newContext({ baseURL });
	const response = await anonymous.get('/manifest.webmanifest');
	expect(response.ok()).toBe(true);
	const manifest = await response.json();
	expect(manifest).toMatchObject({ name: 'mietkartei', display: 'standalone', start_url: '/' });
	for (const icon of manifest.icons as { src: string }[]) {
		expect((await anonymous.get(icon.src)).ok()).toBe(true);
	}
	await anonymous.dispose();

	await page.goto('/einstellungen/benachrichtigungen');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		'href',
		'/manifest.webmanifest'
	);
	// The service worker that shows the Mitteilungen starts with the app.
	const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
	expect(new URL(scope).pathname).toBe('/');
	// The test server has no VAPID_PRIVATE_KEY.
	await expect(page.getByRole('heading', { name: 'Mitteilungen auf diesem Gerät' })).toHaveCount(0);
});
