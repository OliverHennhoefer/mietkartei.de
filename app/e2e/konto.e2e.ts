import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closeLaunchNotice } from './launch-notice';
import { linkInMailTo, readOutbox } from './outbox';
import { owner } from './owner';
import { seedLease } from './seed';
import { FAKE_SUBSCRIPTION_ID, requests, start, stop } from './stripe-fake';

// Project "account", runs last with the owner's storage state: the export, then the deletion
// of the account, after which only the demo data and its reset can run, in an account registered
// anew, and at last the export of the deleted account is restored into it, as after a move. The owner's subscription (sub_fake, started
// in billing.e2e.ts) runs, so the deletion has to cancel it at the Stripe fake first.

test.afterAll(async () => {
	await stop();
});

// The document uploaded before the export; the deletion below checks its file is gone too.
let exported:
	| { accountId: string; documentId: string; fileName: string; content: Buffer; leaseId: string }
	| undefined;
// The downloaded export, restored into the account registered anew at the end.
const exportFile = join('.e2e', 'export.zip');

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
	await download.saveAs(exportFile);

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
	exported = {
		accountId: data.accountId,
		documentId: documentId!,
		fileName,
		content,
		leaseId: lease.leaseId
	};
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
	await expect(page).toHaveURL(/\/aufgaben$/);

	const firstRun = page.getByRole('region', { name: 'Erste Schritte' });
	await firstRun.getByRole('link', { name: 'Demodaten' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);
	await page.getByRole('button', { name: 'Demodaten anlegen' }).click();
	await expect(page).toHaveURL(/\/aufgaben$/);
	await expect(firstRun).toHaveCount(0);
	const attention = page.getByRole('list', { name: 'Offene Aufgaben' });
	await expect(attention).toContainText('Rückstände bei');
	await expect(attention).toContainText('3\u00a0Bankumsätze zuordnen');
	await expect(attention).toContainText('Kontoauszug laden: Rücklagenkonto DKB');
	await expect(page.getByRole('region', { name: 'Nächste Fristen' })).toContainText(
		'Nächste Frist'
	);

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
	await expect(page).toHaveURL(/\/aufgaben$/);
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

test('restores the export of the deleted account into the empty account', async ({ page }) => {
	expect(exported).toBeDefined();
	const { documentId, fileName, content, leaseId } = exported!;
	// The storage state is of the deleted account; the owner registered anew above.
	await page.context().clearCookies();
	await closeLaunchNotice(page);
	await page.goto('/anmelden');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).toHaveURL(/\/aufgaben$/);
	await page.goto('/einstellungen/export');
	const restore = page.getByRole('region', { name: 'Export einspielen' });
	await restore.getByLabel('Exportdatei (ZIP)').setInputFiles(exportFile);
	await restore.getByRole('button', { name: 'Export einspielen' }).click();
	await expect(restore.getByRole('status')).toContainText(
		/Einträge und 1 von 1 Dokumenten übernommen/
	);

	// The lease, its document with every byte, and the log of the old account are back.
	await page.goto(`/vertraege/${leaseId}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const response = await page.request.get(`/dokumente/${documentId}/herunterladen`);
	expect(response.status()).toBe(200);
	expect(Buffer.from(await response.body()).equals(content)).toBe(true);
	await page.goto('/dokumente');
	await expect(page.getByRole('row').filter({ hasText: fileName })).toHaveCount(1);
	await page.goto('/einstellungen/protokoll?entity=account');
	const log = page.getByRole('table', { name: 'Protokoll' });
	await expect(log).toContainText('Export eingespielt');
	await expect(log).toContainText('Stripe-Kunde angelegt');

	// Now the account holds data, so only missing documents can follow, as after an upload that
	// failed part-way; the one document is there already.
	const nachreichen = async () => {
		await page.goto('/einstellungen/export');
		await expect(page.getByText('Dein Konto enthält schon Objekte oder Dokumente.')).toBeVisible();
		await restore.getByLabel('Exportdatei (ZIP)').setInputFiles(exportFile);
		await restore.getByRole('button', { name: 'Dokumente nachreichen' }).click();
	};
	await nachreichen();
	await expect(restore.getByRole('status')).toContainText(
		'0\u00a0Dokumente nachgereicht, 1 schon vorhanden.'
	);

	// On node the file can be lost on purpose; then it follows.
	if (process.env.DEPLOY_TARGET !== 'cloudflare') {
		const folder = join('.e2e', 'documents');
		const [file] = readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((name) =>
			name.endsWith(documentId)
		);
		rmSync(join(folder, file));
		await nachreichen();
		await expect(restore.getByRole('status')).toContainText(
			'1\u00a0Dokument nachgereicht, 0 schon vorhanden.'
		);
		const again = await page.request.get(`/dokumente/${documentId}/herunterladen`);
		expect(Buffer.from(await again.body()).equals(content)).toBe(true);
	}
});
