import { expect, test } from '@playwright/test';
import { mailTo } from './outbox';
import { owner } from './owner';

// The Benachrichtigungen: the hour of the Hinweise, a mail channel with a test that lands in the
// outbox and in the history, and removing the channel again.

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
