import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { linkInMailTo, readOutbox } from './outbox';
import { owner } from './owner';
import { seedLease } from './seed';
import { FAKE_SUBSCRIPTION_ID, requests, start, stop } from './stripe-fake';

// Project "account", runs last with the owner's storage state: the export, then the deletion
// of the account, after which only the demo data and its reset can run, in an account registered anew. The owner's subscription (sub_fake, started
// in billing.e2e.ts) runs, so the deletion has to cancel it at the Stripe fake first.

test.afterAll(async () => {
	await stop();
});

// The document uploaded before the export; the deletion below checks its file is gone too.
let exported: { accountId: string; documentId: string } | undefined;

/** Where the node server keeps the exported document's file (DATA_DIR in playwright.config.ts). */
function storedFile(): string {
	return join('.e2e', 'documents', exported!.accountId, exported!.documentId);
}

test('downloads the export as a ZIP with export.json and the uploaded documents', async ({
	page
}) => {
	// A lease to link the document to, and a document with every byte value, so the copy out
	// of the storage (the R2 bucket on cloudflare) is checked byte for byte.
	const lease = await seedLease(page.request);
	const fileName = `Mietvertrag-${crypto.randomUUID().slice(0, 8)}.pdf`;
	const content = Buffer.concat([
		Buffer.from('%PDF-1.4\n'),
		Buffer.from(Array.from({ length: 256 }, (_, byte) => byte))
	]);
	await page.goto('/dokumente');
	const upload = page.getByRole('form', { name: 'Dokument hochladen' });
	await upload
		.getByLabel('Datei')
		.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: content });
	await upload.getByLabel('Mietvertrag').selectOption(lease.leaseId);
	await upload.getByRole('button', { name: 'Hochladen' }).click();
	await expect(upload.getByRole('status')).toHaveText(`„${fileName}“ wurde hochgeladen.`);
	const href = await page
		.getByRole('row')
		.filter({ hasText: fileName })
		.getByRole('link', { name: 'Herunterladen' })
		.getAttribute('href');
	const documentId = /^\/dokumente\/([0-9a-f-]{36})\/herunterladen$/.exec(href ?? '')?.[1];
	expect(documentId).toBeDefined();

	await page.goto('/einstellungen');
	await page
		.getByRole('navigation', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Export' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Export' })).toBeVisible();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export herunterladen' }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^mietkartei-export-\d{4}-\d{2}-\d{2}\.zip$/);

	const response = await page.request.get('/einstellungen/export/herunterladen');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/zip');
	expect(response.headers()['content-disposition']).toMatch(
		/^attachment; filename="mietkartei-export-/
	);

	const files = unzipSync(new Uint8Array(await response.body()));
	expect(Object.keys(files)).toContain('export.json');
	const stored = files[`documents/${documentId}-${fileName}`];
	expect(stored).toBeDefined();
	expect(Buffer.from(stored).equals(content)).toBe(true);
	const data = JSON.parse(strFromU8(files['export.json'])) as {
		format: string;
		accountId: string;
		tables: Record<string, Record<string, unknown>[]>;
	};
	expect(data.format).toBe('mietkartei');
	expect(data.tables.accounts).toEqual([expect.objectContaining({ id: data.accountId })]);
	expect(data.tables.users.some((user) => user.email === owner.email)).toBe(true);
	expect(data.tables.users.every((user) => !('passwordHash' in user))).toBe(true);
	expect(data.tables.properties).toContainEqual(
		expect.objectContaining({ id: lease.propertyId, accountId: data.accountId })
	);
	expect(data.tables.leases).toContainEqual(
		expect.objectContaining({ id: lease.leaseId, unitId: lease.unitId, baseRent: 60000 })
	);
	expect(data.tables.lease_tenants).toContainEqual({
		leaseId: lease.leaseId,
		tenantId: lease.tenantId
	});
	expect(data.tables.documents).toContainEqual(
		expect.objectContaining({
			id: documentId,
			name: fileName,
			size: content.byteLength,
			leaseId: lease.leaseId
		})
	);
	exported = { accountId: data.accountId, documentId: documentId! };
	// On node the file is visible in DATA_DIR, so the deletion can prove it removes it.
	if (process.env.DEPLOY_TARGET !== 'cloudflare') expect(existsSync(storedFile())).toBe(true);

	await page.goto('/einstellungen/protokoll?entity=account');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Alle Daten als ZIP-Datei exportiert'
	);
});

test('deletes the account after the password is entered again', async ({ page, baseURL }) => {
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();

	await page.goto('/einstellungen');
	await page
		.getByRole('navigation', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Konto' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Konto' })).toBeVisible();
	await expect(page.getByText('Dein Abo wird dabei sofort gekündigt')).toBeVisible();
	// The reset above has a password field too, so the form is found by its section.
	const deletion = page.getByRole('region', { name: 'Konto löschen' });
	await deletion.getByLabel('Passwort').fill('falsches-passwort');
	await deletion.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page.getByText('Das Passwort stimmt nicht.')).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);

	// While Stripe does not answer (the fake is not running), the subscription cannot be
	// canceled, so the account stays.
	await stop();
	await deletion.getByLabel('Passwort').fill(owner.password);
	await deletion.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'Stripe antwortet gerade nicht' })
	).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);

	await start();
	await deletion.getByLabel('Passwort').fill(owner.password);
	await deletion.getByRole('button', { name: 'Konto endgültig löschen' }).click();

	// The owner was the last user, so the instance is empty again: the sign-in page sends every
	// visitor to the registration, and the old credentials do not sign anyone in. The action is
	// posted the way use:enhance does, so its answer is readable without the page's redirect.
	await expect(page).toHaveURL(/\/registrieren$/);
	const cancel = requests.filter(
		(entry) => entry.path === `/v1/subscriptions/${FAKE_SUBSCRIPTION_ID}`
	);
	expect(cancel.map((entry) => entry.method)).toEqual(['DELETE']);
	await page.goto('/anmelden');
	await expect(page).toHaveURL(/\/registrieren$/);
	const response = await page.request.post('/anmelden', {
		form: { email: owner.email, password: owner.password },
		headers: { origin: baseURL!, 'x-sveltekit-action': 'true' }
	});
	expect(response.status()).toBe(400);
	expect((await response.json()) as { type: string }).toMatchObject({ type: 'failure' });
	await page.goto('/objekte');
	await expect(page).toHaveURL(/\/(anmelden|registrieren)$/);

	// The uploaded file, there after the upload, went with the account.
	expect(exported).toBeDefined();
	if (process.env.DEPLOY_TARGET !== 'cloudflare') expect(existsSync(storedFile())).toBe(false);
});

test('fills a fresh account with demo data and resets it to factory settings', async ({ page }) => {
	// After the deletion above the instance is empty: the owner registers again, as in
	// setup.e2e.ts. The hosted variant sends a link; the mail of the first registration is still
	// in the outbox, so the new one is waited for.
	await page.context().clearCookies();
	await page.goto('/registrieren');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	if (process.env.DEPLOY_TARGET === 'cloudflare') {
		const mailsToOwner = async () =>
			(await readOutbox(page.request)).filter((mail) => mail.to === owner.email).length;
		const before = await mailsToOwner();
		await page.getByRole('button', { name: 'Link anfordern' }).click();
		await expect(page.getByRole('status')).toContainText('E-Mail mit einem Link');
		await expect.poll(mailsToOwner).toBe(before + 1);
		await page.goto(await linkInMailTo(page.request, owner.email, '/registrieren/'));
		await page.locator('input[name="password"]').fill(owner.password);
		await page.locator('input[name="passwordConfirm"]').fill(owner.password);
	} else {
		await page.getByLabel('Passwort').fill(owner.password);
	}
	await page.getByRole('button', { name: 'Konto anlegen' }).click();
	await expect(page).toHaveURL(/\/$/);

	const firstRun = page.getByRole('region', { name: 'Erste Schritte' });
	await firstRun.getByRole('link', { name: 'Demodaten' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);
	await page.getByRole('button', { name: 'Demodaten anlegen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(firstRun).toHaveCount(0);
	const tiles = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(tiles.nth(0).locator('.value')).not.toHaveText('0,00 €');
	await expect(tiles.nth(2).locator('.value')).toHaveText('3');

	await page.goto('/objekte');
	await expect(page.getByText('Lindenstraße 12').first()).toBeVisible();
	await expect(page.getByText('Parkallee 8, Wohnung 14').first()).toBeVisible();

	// The button is gone once the account holds data.
	await page.goto('/einstellungen/konto');
	await expect(page.getByRole('button', { name: 'Demodaten anlegen' })).toHaveCount(0);

	// The reset to factory settings deletes the demo data again; the owner stays signed in.
	const reset = page.getByRole('region', { name: 'Auf Werkseinstellungen zurücksetzen' });
	await reset.getByLabel('Tippe ZURÜCKSETZEN zur Bestätigung').fill('ja');
	await reset.getByLabel('Passwort').fill(owner.password);
	await reset.getByRole('button', { name: 'Alle Daten löschen' }).click();
	await expect(reset.getByText('Bitte tippe ZURÜCKSETZEN zur Bestätigung.')).toBeVisible();

	await reset.getByLabel('Tippe ZURÜCKSETZEN zur Bestätigung').fill('ZURÜCKSETZEN');
	await reset.getByLabel('Passwort').fill(owner.password);
	await reset.getByRole('button', { name: 'Alle Daten löschen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('region', { name: 'Erste Schritte' })).toBeVisible();

	await page.goto('/objekte');
	await expect(page.getByText('Lindenstraße 12')).toHaveCount(0);
	await page.goto('/einstellungen/protokoll');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Konto auf Werkseinstellungen zurückgesetzt'
	);
	// An empty account offers the demo data again.
	await page.goto('/einstellungen/konto');
	await expect(page.getByRole('button', { name: 'Demodaten anlegen' })).toBeVisible();
});
