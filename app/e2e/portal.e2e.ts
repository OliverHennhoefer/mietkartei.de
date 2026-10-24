import { expect, test } from '@playwright/test';
import { watchCspViolations } from './csp';
import { linkInMailTo, mailTo } from './outbox';
import { owner } from './owner';
import { seedLease } from './seed';

// The Mieterportal: the landlord makes the link in the lease's tab, a tenant without an account
// reports damage with a photo through it, and the landlord answers on /schadensmeldungen.

// A 1×1 PNG.
const photo = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test('a tenant reports damage through the portal link and sees the landlord’s answer', async ({
	page,
	browser
}) => {
	const tag = crypto.randomUUID().slice(0, 6);
	const tenantEmail = `mieterin-${tag}@example.org`;
	const lease = await seedLease(page.request, { tenant: { email: tenantEmail } });
	const title = `Wasserhahn tropft ${tag}`;

	await page.goto(`/vertraege/${lease.leaseId}/mieterportal`);
	await expect(page.getByRole('heading', { level: 2, name: 'Mieterportal' })).toBeVisible();
	await expect(page.getByText('Für diesen Mietvertrag gibt es noch keinen Link.')).toBeVisible();
	await page.getByRole('button', { name: 'Link erzeugen' }).click();
	const field = page.getByLabel('Link zum Mieterportal');
	await expect(field).toHaveValue(/\/mieterportal\/[\w-]{43}$/);
	const link = await field.inputValue();

	// The tenant has no session and a client address of their own. A new context would inherit
	// the owner's storage state from the project otherwise.
	const tenant = await browser.newContext({
		storageState: { cookies: [], origins: [] },
		extraHTTPHeaders: { 'cf-connecting-ip': '192.0.2.30' }
	});
	const portal = await tenant.newPage();
	const violations = watchCspViolations(portal);
	const response = await portal.goto(link);
	expect(response?.headers()['cache-control']).toBe('private, no-store');
	await expect(portal.getByRole('heading', { level: 1, name: 'Mieterportal' })).toBeVisible();
	await expect(portal).toHaveTitle('Mieterportal | mietkartei');
	await expect(portal.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);
	await expect(portal.getByText('Über diesen Link wurde noch nichts gemeldet.')).toBeVisible();

	await portal.getByLabel('Was ist kaputt?').fill(title);
	await portal.getByLabel('Wo genau? (optional)').fill('Bad');
	await portal.getByLabel('Beschreibung').fill('Tropft seit Montag, auch zugedreht.');
	await portal.getByLabel(/Dringend, es entsteht/).check();
	await portal
		.getByLabel('Fotos (optional, bis zu 3)')
		.setInputFiles({ name: 'hahn.png', mimeType: 'image/png', buffer: photo });
	await portal.getByLabel('Telefon für Rückfragen (optional)').fill('0171 123456');
	await portal.getByRole('button', { name: 'Meldung senden' }).click();
	await expect(portal.getByRole('status')).toContainText(
		`Ihre Meldung „${title}“ ist eingegangen.`
	);
	const mine = portal.getByRole('list', { name: 'Ihre Meldungen' }).getByRole('listitem');
	await expect(mine).toHaveCount(1);
	await expect(mine).toContainText(title);
	await expect(mine).toContainText('Eingegangen');
	await expect(mine).toContainText('dringend');

	// The users of the account get a mail with a link to the report.
	const mail = await mailTo(page.request, owner.email);
	expect(mail.subject).toBe(`Dringende Schadensmeldung: ${title}`);
	const reportLink = await linkInMailTo(page.request, owner.email, '/schadensmeldungen/');

	await page.goto('/');
	await expect(page.getByRole('link', { name: /neue Schadensmeldung/ })).toBeVisible();
	await page.goto('/schadensmeldungen');
	const open = page.getByRole('list', { name: 'Offene Schadensmeldungen' });
	await open.getByRole('link', { name: title }).click();
	await expect(page).toHaveURL(new URL(reportLink).pathname);
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	await expect(page.getByText('Tropft seit Montag, auch zugedreht.')).toBeVisible();
	await expect(page.getByRole('link', { name: '0171 123456' })).toHaveAttribute(
		'href',
		'tel:0171 123456'
	);
	const image = page.getByRole('img', { name: 'hahn.png' });
	await expect(image).toBeVisible();
	expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

	await page.getByLabel('Status').selectOption({ label: 'In Bearbeitung' });
	await page
		.getByLabel('Antwort an die Mieter (optional)')
		.fill('Der Installateur kommt Donnerstag.');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('status')).toHaveText('Gespeichert.');

	await portal.reload();
	await expect(mine).toContainText('In Bearbeitung');
	await expect(mine).toContainText('Der Installateur kommt Donnerstag.');
	expect(violations).toEqual([]);

	// Taking it over as a task leads to the task, linked to the lease.
	await page.getByRole('button', { name: 'Als Aufgabe übernehmen' }).click();
	await expect(page).toHaveURL(/\/aufgaben\/[\w-]+$/);
	await expect(page.getByRole('heading', { level: 1, name: `Schaden: ${title}` })).toBeVisible();

	// A link mailed to the tenant replaces the one shown before.
	await page.goto(`/vertraege/${lease.leaseId}/mieterportal`);
	await expect(page.getByText(/Der Link ist aktiv seit/)).toBeVisible();
	await page.getByRole('button', { name: 'Neuen Link per E-Mail schicken' }).click();
	await expect(page.getByRole('status')).toHaveText(`Der Link wurde an ${tenantEmail} geschickt.`);
	const mailed = await linkInMailTo(page.request, tenantEmail, '/mieterportal/');
	expect((await portal.goto(link))?.status()).toBe(404);
	await portal.goto(mailed);
	await expect(mine).toContainText(title);

	// Locked, the link leads nowhere.
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Link sperren' }).click();
	await expect(page.getByRole('status')).toHaveText('Der Link ist gesperrt.');
	expect((await portal.goto(mailed))?.status()).toBe(404);
	await tenant.close();
});
