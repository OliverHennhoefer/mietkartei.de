import { expect, test } from '@playwright/test';
import { closeLaunchNotice } from './launch-notice';
import { linkInMailTo } from './outbox';
import { clearTables } from './seed';

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
		.getByRole('navigation', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Zugänge' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Zugänge' })).toBeVisible();
	await expect(page.getByRole('table', { name: 'Zugänge' })).toContainText('(du)');

	// The feature tests, which have all finished, leave seeded managers and invitations in the
	// account. They are removed, so the account has free seats for this test.
	page.on('dialog', (dialog) => dialog.accept());
	await clearTables(page.request, ['invitations']);
	await page.reload();
	const remove = page
		.getByRole('table', { name: 'Zugänge' })
		.getByRole('button', { name: 'Entfernen' });
	for (let left = await remove.count(); left > 0; left--) {
		await remove.first().click();
		await expect(remove).toHaveCount(left - 1);
	}
	await page.getByLabel('E-Mail-Adresse').fill(manager.email);
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(page.getByRole('status')).toContainText(`Die Einladung an ${manager.email}`);
	await expect(page.getByRole('table', { name: 'Einladungen' })).toContainText(manager.email);
	const link = await linkInMailTo(page.request, manager.email, '/einladung/');

	// The same address cannot be invited twice while the invitation is open.
	await page.getByLabel('E-Mail-Adresse').fill(manager.email);
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(page.getByText('Diese E-Mail-Adresse ist schon eingeladen.')).toBeVisible();

	// The invitee has no session of their own yet.
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const invitee = await context.newPage();
	await closeLaunchNotice(invitee);
	await invitee.goto(link);
	await expect(invitee.getByRole('heading', { level: 1, name: 'Einladung' })).toBeVisible();
	await expect(invitee.getByLabel('E-Mail-Adresse')).toHaveValue(manager.email);
	await invitee.getByLabel('Name').fill('Max Mitverwalter');
	await invitee.locator('input[name="password"]').fill(manager.password);
	await invitee.locator('input[name="passwordConfirm"]').fill(manager.password);
	await invitee.getByRole('button', { name: 'Konto anlegen' }).click();
	await expect(invitee).toHaveURL(/\/$/);
	await expect(invitee.getByRole('button', { name: 'Konto' })).toContainText('Max Mitverwalter');

	// A manager works in the owner's account but does not manage invitations.
	const objekte = await invitee.goto('/objekte');
	expect(objekte?.status()).toBe(200);
	await expect(invitee.getByRole('heading', { level: 1, name: 'Objekte' })).toBeVisible();
	const forbidden = await invitee.goto('/einstellungen/zugaenge');
	expect(forbidden?.status()).toBe(403);
	await expect(invitee.getByText('Das darf nur der Vermieter des Kontos.')).toBeVisible();
	const invite = await invitee.request.post('/einstellungen/zugaenge?/invite', {
		form: { email: 'durch-mitverwalter@example.org' },
		headers: { origin: baseURL! }
	});
	expect(invite.status()).toBe(403);
	// The export and the account deletion are the owner's as well.
	const download = await invitee.request.get('/einstellungen/export/herunterladen');
	expect(download.status()).toBe(403);
	await invitee.goto('/einstellungen/konto');
	await expect(invitee.getByText('Nur der Vermieter kann das Konto löschen.')).toBeVisible();
	const deleteAccount = await invitee.request.post('/einstellungen/konto?/delete', {
		form: { password: manager.password },
		headers: { origin: baseURL! }
	});
	expect(deleteAccount.status()).toBe(403);
	// Demo data as well: no button, and the action answers 403.
	await expect(invitee.getByRole('button', { name: 'Demodaten anlegen' })).toHaveCount(0);
	const demo = await invitee.request.post('/einstellungen/konto?/demo', {
		form: {},
		headers: { origin: baseURL! }
	});
	expect(demo.status()).toBe(403);

	// Bank accounts are the owner's too: the page says so, the actions answer 403.
	await invitee.goto('/bank/konten');
	await expect(
		invitee.getByText('Bankverbindungen sieht nur der Vermieter des Kontos.')
	).toBeVisible();
	const createBankAccount = await invitee.request.post('/bank/konten?/create', {
		form: { name: 'Fremdkonto', iban: 'DE89370400440532013000', holder: 'Max Mitverwalter' },
		headers: { origin: baseURL! }
	});
	expect(createBankAccount.status()).toBe(403);
	// So is the subscription: the page says who manages it, the actions answer 403.
	await invitee.goto('/abo');
	await expect(invitee.getByText('Das Abo verwaltet der Vermieter des Kontos.')).toBeVisible();
	await expect(invitee.getByRole('button', { name: 'Abo abschließen' })).toHaveCount(0);
	const checkout = await invitee.request.post('/abo?/checkout', {
		form: {},
		headers: { origin: baseURL! }
	});
	expect(checkout.status()).toBe(403);
	// The settings hub does not send a manager to the owner-only pages.
	await invitee.goto('/einstellungen');
	const hub = invitee.getByRole('navigation', { name: 'Einstellungen' });
	await expect(hub.getByRole('link', { name: 'Profil' })).toBeVisible();
	await expect(hub.getByRole('link', { name: 'Protokoll' })).toBeVisible();
	await expect(hub.getByRole('link', { name: 'Konto' })).toBeVisible();
	await expect(hub.getByRole('link', { name: 'Zugänge' })).toHaveCount(0);
	await expect(hub.getByRole('link', { name: 'Export' })).toHaveCount(0);

	// The used link cannot be used again.
	await invitee.goto(link);
	await expect(invitee.getByText('Diese Einladung wurde schon angenommen.')).toBeVisible();

	// The owner sees the new user instead of the invitation, and the log names the acceptance.
	// Other tests may leave invitations of their own, so only these rows are checked.
	const invitations = page.getByRole('table', { name: 'Einladungen' });
	await page.reload();
	await expect(page.getByRole('table', { name: 'Zugänge' })).toContainText('Max Mitverwalter');
	await expect(invitations.getByRole('row', { name: new RegExp(manager.email) })).toHaveCount(0);
	await page.goto('/einstellungen/protokoll?entity=user');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Max Mitverwalter hat die Einladung angenommen und ist jetzt als Mitverwalter dabei'
	);
	await page.goto('/einstellungen/zugaenge');

	// With Lesezugriff, the manager still reads but can change nothing.
	const people = page.getByRole('table', { name: 'Zugänge' });
	await people.getByLabel('Rolle von Max Mitverwalter').selectOption('viewer');
	await people
		.getByRole('row', { name: /Max Mitverwalter/ })
		.getByRole('button', { name: 'Ändern' })
		.click();
	await expect(page.getByText('Die Rolle wurde geändert.')).toBeVisible();
	await invitee.goto('/');
	await expect(invitee.getByText('Du hast Lesezugriff und kannst nichts ändern.')).toBeVisible();
	expect((await invitee.goto('/objekte/neu'))?.status()).toBe(403);
	const write = await invitee.request.post('/objekte/neu', {
		form: { name: 'Fremdobjekt' },
		headers: { origin: baseURL! }
	});
	expect(write.status()).toBe(403);

	// A second invitation is sent again and revoked before anyone uses it; its links then lead nowhere.
	const second = 'zweite-einladung@example.org';
	await page.getByLabel('E-Mail-Adresse').fill(second);
	await page.getByRole('button', { name: 'Einladen' }).click();
	await expect(invitations).toContainText(second);
	const firstLink = await linkInMailTo(page.request, second, '/einladung/');

	// Sending it again replaces the link.
	await invitations
		.getByRole('row', { name: new RegExp(second) })
		.getByRole('button', { name: 'Erneut senden' })
		.click();
	await expect(page.getByRole('status')).toContainText(`Die Einladung an ${second}`);
	await expect(invitations.getByRole('row', { name: new RegExp(second) })).toHaveCount(1);
	expect((await page.request.get(firstLink)).status()).toBe(404);
	const secondLink = await linkInMailTo(page.request, second, '/einladung/');
	expect(secondLink).not.toBe(firstLink);
	await invitations
		.getByRole('row', { name: new RegExp(second) })
		.getByRole('button', { name: 'Zurückziehen' })
		.click();
	await expect(page.getByText('Die Einladung wurde zurückgezogen.')).toBeVisible();
	await expect(invitations.getByRole('row', { name: new RegExp(second) })).toHaveCount(0);
	expect((await page.request.get(secondLink)).status()).toBe(404);

	// Removing the manager ends their access at once, including the open session.
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
