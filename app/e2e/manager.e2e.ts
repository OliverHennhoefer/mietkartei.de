import { expect, test } from '@playwright/test';
import { owner } from './owner';

// Project "manager": no storage state. The owner invites a manager through the page, the
// manager registers through the link from the mail in a browser context of their own.

const manager = { email: 'manager@example.org', password: 'passwort-des-mitverwalters' };

test('the owner invites a manager, who registers through the link', async ({ page, browser }) => {
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/$/);

	await page.goto('/einstellungen/mitverwalter');
	await expect(page.getByRole('heading', { level: 1, name: 'Mitverwalter' })).toBeVisible();
	await expect(page.getByRole('table', { name: 'Zugänge' })).toContainText('(du)');
	await page.getByLabel('E-Mail-Adresse').fill(manager.email);
	await page.getByLabel('Rolle').selectOption({ label: 'Mitverwalter' });
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(page.getByRole('status')).toContainText(`Die Einladung an ${manager.email}`);
	await expect(page.getByRole('table', { name: 'Offene Einladungen' })).toContainText(
		manager.email
	);

	const response = await page.request.get('/__e2e/outbox');
	const mails = (await response.json()) as { to: string; text: string }[];
	const mail = mails.find((candidate) => candidate.to === manager.email);
	expect(mail).toBeDefined();
	const link = mail!.text.match(/https?:\/\/\S+\/einladung\/[A-Za-z0-9_-]+/)?.[0];
	expect(link).toBeDefined();

	// The invitee has no session of their own yet.
	const context = await browser.newContext();
	const invitee = await context.newPage();
	await invitee.goto(link!);
	await expect(invitee.getByRole('heading', { level: 1, name: 'Einladung' })).toBeVisible();
	await expect(invitee.getByLabel('E-Mail-Adresse')).toHaveValue(manager.email);
	await invitee.getByLabel('Name').fill('Max Mitverwalter');
	await invitee.locator('input[name="password"]').fill(manager.password);
	await invitee.locator('input[name="passwordConfirm"]').fill(manager.password);
	await invitee.getByRole('button', { name: 'Konto anlegen' }).click();
	await expect(invitee).toHaveURL(/\/$/);
	await expect(invitee.getByRole('navigation')).toContainText('Max Mitverwalter');

	// A manager works in the owner's account but does not manage invitations.
	const objekte = await invitee.goto('/objekte');
	expect(objekte?.status()).toBe(200);
	await expect(invitee.getByRole('heading', { level: 1, name: 'Objekte' })).toBeVisible();
	const forbidden = await invitee.goto('/einstellungen/mitverwalter');
	expect(forbidden?.status()).toBe(403);
	await expect(invitee.getByText('Das dürfen nur Vermieter, keine Mitverwalter.')).toBeVisible();
	await invitee.goto('/einstellungen/konto');
	await expect(invitee.getByText('Nur der Vermieter kann das Konto löschen.')).toBeVisible();
	// The settings hub does not send a manager to the owner-only pages.
	await invitee.goto('/einstellungen');
	const hub = invitee.getByRole('list', { name: 'Einstellungen' });
	await expect(hub.getByRole('link', { name: 'Profil' })).toBeVisible();
	await expect(hub.getByRole('link', { name: 'Mitverwalter' })).toHaveCount(0);
	await expect(hub.getByRole('link', { name: 'Export' })).toHaveCount(0);

	// The used link cannot be used again.
	await invitee.goto(link!);
	await expect(invitee.getByText('Diese Einladung wurde schon angenommen.')).toBeVisible();
	await context.close();

	// The owner sees the new user instead of the invitation.
	await page.reload();
	await expect(page.getByRole('table', { name: 'Zugänge' })).toContainText('Max Mitverwalter');
	await expect(page.getByText('Keine offenen Einladungen.')).toBeVisible();
});
