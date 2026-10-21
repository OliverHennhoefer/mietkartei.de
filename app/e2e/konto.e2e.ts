import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { owner } from './owner';
import { seedLease } from './seed';

// Project "account", runs last with the owner's storage state: the export, then the deletion
// of the account, after which nothing else can run.

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
	const documentId = /^\/dokumente\/([0-9a-f-]{36})\/herunterladen$/.exec(href ?? '')?.[1];
	expect(documentId).toBeDefined();

	await page.goto('/einstellungen');
	await page
		.getByRole('list', { name: 'Einstellungen' })
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

	await page.goto('/einstellungen/protokoll?entity=account');
	await expect(page.getByRole('table', { name: 'Protokoll' })).toContainText(
		'Alle Daten als ZIP-Datei exportiert'
	);
});

test('deletes the account after the password is entered again', async ({ page, baseURL }) => {
	await page.goto('/einstellungen');
	await page
		.getByRole('list', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Konto' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Konto' })).toBeVisible();
	await page.getByLabel('Passwort').fill('falsches-passwort');
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
	await expect(page.getByText('Das Passwort stimmt nicht.')).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/konto$/);

	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();

	// The owner was the last user, so the instance is empty again: the sign-in page sends every
	// visitor to the registration, and the old credentials do not sign anyone in. The action is
	// posted the way use:enhance does, so its answer is readable without the page's redirect.
	await expect(page).toHaveURL(/\/registrieren$/);
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
