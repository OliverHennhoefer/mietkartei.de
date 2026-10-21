import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { owner } from './owner';
import { FAKE_SUBSCRIPTION_ID, requests, start, stop } from './stripe-fake';
import { clearTables, seedLease, seedRows } from './seed';

// Project "account", runs last with the owner's storage state: the export, then the deletion
// of the account, after which nothing else can run. The owner's subscription (sub_fake, started
// in billing.e2e.ts) runs, so the deletion has to cancel it at the Stripe fake first.

test.afterAll(async () => {
	await stop();
});

// The document uploaded before the export; the deletion below checks its file is gone too.
let exported: { accountId: string; documentId: string } | undefined;

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
	const documentId = /^\/dokumente\/([0-9a-f-]{36})\/download$/.exec(href ?? '')?.[1];
	expect(documentId).toBeDefined();

	await page.goto('/einstellungen/export');
	await expect(page.getByRole('button', { name: 'Export herunterladen' })).toBeVisible();

	const response = await page.request.get('/einstellungen/export/download');
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

	await page.goto('/einstellungen/protokoll?entity=account');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Alle Daten als ZIP-Datei exportiert'
	);
});

test('deletes the account after the password is entered again', async ({ page, baseURL }) => {
	await page.goto('/abo');
	await expect(page.getByText('Dein Abo ist aktiv.')).toBeVisible();

	await page.goto('/einstellungen/konto');
	await expect(page.getByText('Dein Abo wird dabei sofort gekündigt')).toBeVisible();
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page.getByText('Das Passwort stimmt nicht.')).toBeVisible();

	// While Stripe does not answer (the fake is not running), the subscription cannot be
	// canceled, so the account stays.
	await stop();
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'Stripe antwortet gerade nicht' })
	).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);

	await start();
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page).toHaveURL(/\/registrieren$/);
	const cancel = requests.filter(
		(entry) => entry.path === `/v1/subscriptions/${FAKE_SUBSCRIPTION_ID}`
	);
	expect(cancel.map((entry) => entry.method)).toEqual(['DELETE']);

	// The owner was the last user, so the instance is empty again: the sign-in page sends every
	// visitor to the registration, and the old credentials do not sign anyone in. The action is
	// posted the way use:enhance does, so its answer is readable without the page's redirect.
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

	// The uploaded file went with the account (on node it is visible in DATA_DIR).
	expect(exported).toBeDefined();
	if (process.env.DEPLOY_TARGET !== 'cloudflare') {
		const file = join('.e2e', 'documents', exported!.accountId, exported!.documentId);
		expect(existsSync(file)).toBe(false);
	}
});

test('fills a fresh account with demo data from the account page', async ({ page }) => {
	// After the deletion above the instance is empty: register again, then load the demo.
	await page.context().clearCookies();
	await page.goto('/registrieren');
	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto anlegen' }).click();
	await expect(page).not.toHaveURL(/\/registrieren$/);

	// The first-run checklist shows instead of the tiles, each step linked to its create page.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Kennzahlen' })).toHaveCount(0);
	const steps = page.locator('.first-run ol > li');
	await expect(steps.getByRole('link')).toHaveText([
		'Objekt anlegen',
		'Einheit anlegen',
		'Mieter anlegen',
		'Mietvertrag mit Miete und Kaution anlegen',
		'Bankverbindung für den Umsatzabgleich anlegen',
		'Kostenarten und Umlageschlüssel prüfen'
	]);
	await expect(steps.nth(0).getByRole('link')).toHaveAttribute('href', '/objekte/neu');
	await expect(steps.nth(5).getByRole('link')).toHaveAttribute(
		'href',
		'/betriebskosten/kostenarten'
	);

	// With a property but no lease and no bank account it stays, the property ticked off and the
	// unit step pointing to the property's page with the unit form.
	const {
		ids: [propertyId]
	} = await seedRows(page.request, 'properties', [
		{ name: 'Erstes Haus', street: 'Anfangsweg 1', postalCode: '10115', city: 'Berlin' }
	]);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Kennzahlen' })).toHaveCount(0);
	await expect(steps.nth(0)).toContainText('erledigt');
	await expect(steps.nth(1)).not.toContainText('erledigt');
	await expect(steps.nth(1).getByRole('link')).toHaveAttribute('href', `/objekte/${propertyId}`);
	// Demo data only goes into an account without any property.
	await expect(page.getByRole('link', { name: 'Demodaten' })).toHaveCount(0);
	await clearTables(page.request, ['properties']);

	await page.goto('/');
	await page.getByRole('link', { name: 'Demodaten' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);
	await page.getByRole('button', { name: 'Demodaten anlegen' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toHaveCount(0);
	const tiles = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(tiles.nth(0).locator('.value')).not.toHaveText('0,00 €');
	await expect(tiles.nth(2).locator('.value')).toHaveText('3');

	await page.goto('/objekte');
	await expect(page.getByText('Lindenstraße 12').first()).toBeVisible();
	await expect(page.getByText('Gartenweg 3').first()).toBeVisible();

	// The button is gone once the account holds data.
	await page.goto('/einstellungen/konto');
	await expect(page.getByRole('button', { name: 'Demodaten anlegen' })).toHaveCount(0);
});
