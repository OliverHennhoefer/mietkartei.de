import { expect, test } from '@playwright/test';
import { linkInMailTo } from './outbox';

// Project "manager", with the owner's storage state. The owner invites a manager through the
// page, the manager registers through the link from the mail in a browser context of their own.

const manager = { email: 'manager@example.org', password: 'passwort-des-mitverwalters' };

test('the owner invites a manager, who registers through the link', async ({
	page,
	browser,
	baseURL
}) => {
	await page.goto('/einstellungen');
	await page
		.getByRole('list', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Mitverwalter' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Mitverwalter' })).toBeVisible();
	await expect(page.getByRole('table', { name: 'Zugänge' })).toContainText('(du)');
	await page.getByLabel('E-Mail-Adresse').fill(manager.email);
	await page.getByLabel('Rolle').selectOption({ label: 'Mitverwalter' });
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(page.getByRole('status')).toContainText(`Die Einladung an ${manager.email}`);
	await expect(page.getByRole('table', { name: 'Offene Einladungen' })).toContainText(
		manager.email
	);
	const link = await linkInMailTo(page.request, manager.email, '/einladung/');

	// The same address cannot be invited twice while the invitation is open.
	await page.getByLabel('E-Mail-Adresse').fill(manager.email);
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(page.getByText('Diese E-Mail-Adresse ist schon eingeladen.')).toBeVisible();

	// The invitee has no session of their own yet.
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const invitee = await context.newPage();
	await invitee.goto(link);
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
	const invite = await invitee.request.post('/einstellungen/mitverwalter?/invite', {
		form: { email: 'durch-mitverwalter@example.org' },
		headers: { origin: baseURL! }
	});
	expect(invite.status()).toBe(403);

	// Bank accounts are the owner's too: the page says so, the actions answer 403.
	await invitee.goto('/bank/konten');
	await expect(
		invitee.getByText('Bankverbindungen sind nur für Vermieter sichtbar, nicht für Mitverwalter.')
	).toBeVisible();
	const createBankAccount = await invitee.request.post('/bank/konten?/create', {
		form: { name: 'Fremdkonto', iban: 'DE89370400440532013000', holder: 'Max Mitverwalter' },
		headers: { origin: baseURL! }
	});
	expect(createBankAccount.status()).toBe(403);
	// The settings hub does not send a manager to the owner-only pages.
	await invitee.goto('/einstellungen');
	const hub = invitee.getByRole('list', { name: 'Einstellungen' });
	await expect(hub.getByRole('link', { name: 'Profil' })).toBeVisible();
	await expect(hub.getByRole('link', { name: 'Protokoll' })).toBeVisible();
	await expect(hub.getByRole('link', { name: 'Mitverwalter' })).toHaveCount(0);

	// The used link cannot be used again.
	await invitee.goto(link);
	await expect(invitee.getByText('Diese Einladung wurde schon angenommen.')).toBeVisible();

	// The owner sees the new user instead of the invitation, and the log names the acceptance.
	// Other tests may leave invitations of their own, so only these rows are checked.
	const invitations = page.getByRole('table', { name: 'Offene Einladungen' });
	await page.reload();
	await expect(page.getByRole('table', { name: 'Zugänge' })).toContainText('Max Mitverwalter');
	await expect(invitations.getByRole('row', { name: new RegExp(manager.email) })).toHaveCount(0);
	await page.goto('/einstellungen/protokoll?entity=user');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Max Mitverwalter hat die Einladung angenommen und ist jetzt Mitverwalter'
	);
	await page.goto('/einstellungen/mitverwalter');

	// A second invitation is revoked before anyone uses it; its link then leads nowhere.
	const second = 'zweite-einladung@example.org';
	await page.getByLabel('E-Mail-Adresse').fill(second);
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(invitations).toContainText(second);
	const secondLink = await linkInMailTo(page.request, second, '/einladung/');
	await invitations
		.getByRole('row', { name: new RegExp(second) })
		.getByRole('button', { name: 'Zurückziehen' })
		.click();
	await expect(page.getByText('Die Einladung wurde zurückgezogen.')).toBeVisible();
	await expect(invitations.getByRole('row', { name: new RegExp(second) })).toHaveCount(0);
	expect((await page.request.get(secondLink)).status()).toBe(404);

	// Removing the manager ends their access at once, including the open session.
	page.on('dialog', (dialog) => dialog.accept());
	const users = page.getByRole('table', { name: 'Zugänge' });
	await users
		.getByRole('row', { name: /Max Mitverwalter/ })
		.getByRole('button', { name: 'Entfernen' })
		.click();
	await expect(users).not.toContainText('Max Mitverwalter');
	await invitee.goto('/objekte');
	await expect(invitee).toHaveURL(/\/anmelden$/);
	await invitee.getByLabel('E-Mail-Adresse').fill(manager.email);
	await invitee.getByLabel('Passwort').fill(manager.password);
	await invitee.getByRole('button', { name: 'Anmelden' }).click();
	await expect(invitee.getByRole('alert')).toHaveText(
		'E-Mail-Adresse oder Passwort stimmen nicht.'
	);
	await context.close();
});
