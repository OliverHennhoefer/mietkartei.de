import { expect, test, type Page } from '@playwright/test';
import { seedLease } from './seed';

// The documents feature: /dokumente (upload, list, filter, delete), the download route and the
// Dokumente tab of a lease. Leases come from the seed; only the feature's own pages are driven.

const uploadForm = (page: Page) => page.getByRole('form', { name: 'Dokument hochladen' });
const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test('uploads a document, shows it on the lease, downloads, filters and deletes it', async ({
	page
}) => {
	const lease = await seedLease(page.request);
	const other = await seedLease(page.request);
	const tag = crypto.randomUUID().slice(0, 8);
	const fileName = `Übergabeprotokoll-${tag}.txt`;
	const content = Buffer.from(`Übergabeprotokoll ${tag}\nZählerstand Strom 12345\n`, 'utf8');

	await page.goto('/dokumente');
	await expect(page.getByRole('heading', { level: 1, name: 'Dokumente' })).toBeVisible();
	await expect(page).toHaveTitle('Dokumente · mietkartei');

	const upload = uploadForm(page);
	await upload
		.getByLabel('Datei')
		.setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: content });
	await upload.getByLabel('Mietvertrag').selectOption(lease.leaseId);
	await upload.getByRole('button', { name: 'Hochladen' }).click();
	await expect(upload.getByRole('status')).toHaveText(`„${fileName}“ wurde hochgeladen.`);

	// The list shows name, type, size and the lease link as text.
	const row = rowOf(page, fileName);
	await expect(row).toBeVisible();
	await expect(row).toContainText('Text');
	await expect(row).toContainText(`${content.byteLength}\u00a0B`);
	const leaseLink = row.getByRole('link', { name: /Erika Muster-/ });
	await expect(leaseLink).toHaveAttribute('href', `/vertraege/${lease.leaseId}`);
	await expect(leaseLink).toContainText('Wohnung');

	// The lease's Dokumente tab lists it too, without repeating the lease.
	await page.goto(`/vertraege/${lease.leaseId}/dokumente`);
	await expect(page.getByRole('heading', { level: 2, name: 'Dokumente' })).toBeVisible();
	const leaseRow = rowOf(page, fileName);
	await expect(leaseRow).toBeVisible();
	await expect(leaseRow.getByRole('link', { name: /Erika Muster-/ })).toHaveCount(0);

	// The download carries the bytes and the name, with an ASCII fallback for old clients.
	const href = await leaseRow.getByRole('link', { name: 'Herunterladen' }).getAttribute('href');
	expect(href).toMatch(/^\/dokumente\/[0-9a-f-]{36}\/download$/);
	const download = await page.request.get(href!);
	expect(download.status()).toBe(200);
	expect(download.headers()['content-type']).toBe('text/plain');
	expect(download.headers()['content-length']).toBe(String(content.byteLength));
	expect(download.headers()['content-disposition']).toBe(
		`attachment; filename="Uebergabeprotokoll-${tag}.txt"; filename*=UTF-8''${encodeURIComponent(fileName)}`
	);
	expect(download.headers()['cache-control']).toBe('private, no-store');
	expect(Buffer.from(await download.body()).equals(content)).toBe(true);
	// A text file is never shown inline, whatever the query says.
	const inline = await page.request.get(`${href}?inline=1`);
	expect(inline.headers()['content-disposition']).toMatch(/^attachment;/);

	// The filter narrows the list to one lease.
	await page.goto('/dokumente');
	const filter = page.getByRole('form', { name: 'Filter' });
	await filter.getByLabel('Mietvertrag').selectOption(lease.leaseId);
	await filter.getByRole('button', { name: 'Filtern' }).click();
	await expect(page).toHaveURL(new RegExp(`leaseId=${lease.leaseId}`));
	await expect(rowOf(page, fileName)).toBeVisible();
	await filter.getByLabel('Mietvertrag').selectOption(other.leaseId);
	await filter.getByRole('button', { name: 'Filtern' }).click();
	await expect(page.getByText('Keine Dokumente für diese Auswahl.')).toBeVisible();
	await page.getByRole('link', { name: 'Alle Dokumente anzeigen' }).click();
	await expect(page).toHaveURL(/\/dokumente$/);

	// Deleting asks first, then removes the row and the file.
	page.once('dialog', (dialog) => dialog.accept());
	await rowOf(page, fileName).getByRole('button', { name: 'Löschen' }).click();
	await expect(rowOf(page, fileName)).toHaveCount(0);
	expect((await page.request.get(href!)).status()).toBe(404);
});

test('uploads a PDF on the lease tab with a typed name and shows it inline', async ({ page }) => {
	const lease = await seedLease(page.request);
	const tag = crypto.randomUUID().slice(0, 8);
	const content = Buffer.from('%PDF-1.4\n% not a real document\n', 'utf8');

	await page.goto(`/vertraege/${lease.leaseId}/dokumente`);
	await expect(
		page.getByText('Noch keine Dokumente zu diesem Mietvertrag', { exact: false })
	).toBeVisible();
	const upload = uploadForm(page);
	await upload
		.getByLabel('Datei')
		.setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: content });
	await upload.getByLabel('Name (optional)').fill(`Mietvertrag ${tag}`);
	await upload.getByRole('button', { name: 'Hochladen' }).click();

	// The typed name keeps the file's extension; the lease's property is linked as well.
	const name = `Mietvertrag ${tag}.pdf`;
	const row = rowOf(page, name);
	await expect(row).toBeVisible();
	await expect(row).toContainText('PDF');
	await expect(row.getByRole('link', { name: /Testhaus/ })).toHaveAttribute(
		'href',
		`/objekte/${lease.propertyId}`
	);
	const view = row.getByRole('link', { name: 'Ansehen' });
	const href = await view.getAttribute('href');
	expect(href).toMatch(/\?inline=1$/);
	const response = await page.request.get(href!);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/pdf');
	expect(response.headers()['content-disposition']).toBe(
		`inline; filename="Mietvertrag ${tag}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`
	);
	expect(Buffer.from(await response.body()).equals(content)).toBe(true);

	// It is one of all documents, filtered by the lease.
	await page.goto(`/dokumente?leaseId=${lease.leaseId}`);
	await expect(rowOf(page, name)).toBeVisible();

	page.once('dialog', (dialog) => dialog.accept());
	await rowOf(page, name).getByRole('button', { name: 'Löschen' }).click();
	await expect(rowOf(page, name)).toHaveCount(0);
});

test('refuses an empty file and a file over 10 MB with a German sentence', async ({ page }) => {
	await page.goto('/dokumente');
	const upload = uploadForm(page);

	await upload
		.getByLabel('Datei')
		.setInputFiles({ name: 'leer.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
	await upload.getByRole('button', { name: 'Hochladen' }).click();
	await expect(upload.getByText('Die Datei ist leer.')).toBeVisible();

	// 10,5 MB: over the document limit, under the server's body limit of 12 MB.
	await upload.getByLabel('Datei').setInputFiles({
		name: 'gross.bin',
		mimeType: 'application/octet-stream',
		buffer: Buffer.alloc(Math.round(10.5 * 1024 * 1024), 1)
	});
	await upload.getByRole('button', { name: 'Hochladen' }).click();
	await expect(upload.getByText('Die Datei ist zu groß (höchstens 10 MB).')).toBeVisible();
});

test('answers an unknown document id on the download route with 404', async ({ page }) => {
	const response = await page.request.get('/dokumente/does-not-exist/download');
	expect(response.status()).toBe(404);
	// In the browser, SvelteKit answers an endpoint's error with its plain error page.
	const htmlResponse = await page.goto('/dokumente/does-not-exist/download');
	expect(htmlResponse?.status()).toBe(404);
	await expect(page.getByText('Dieses Dokument gibt es nicht.')).toBeVisible();
});
