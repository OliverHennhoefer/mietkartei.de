import { expect, test } from '@playwright/test';
import { clearTables, seedForeignLease, seedLease } from './seed';

// The rent feature: VPI values, the index proposal with its approval and letter, and a manual
// change. The lease is seeded; only /einstellungen/vpi and the Miethöhe tab are driven.

test('adjusts an index rent from the VPI and writes the letter', async ({ page }) => {
	// An indexed residential lease from 2024-01-01 at 600 € + 150 € + 50 €, base index
	// January 2024 = 118,2. The VPI table starts empty, whatever other tests left behind.
	await clearTables(page.request, ['consumer_price_index']);
	const { leaseId } = await seedLease(page.request, {
		tenant: { salutation: 'Frau', street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' },
		lease: {
			rentModel: 'indexed',
			indexBaseMonth: '2024-01',
			indexBaseValue: 118.2,
			startDate: '2024-01-01'
		}
	});

	// Two VPI values; the newer one counts.
	await page.goto('/einstellungen/vpi');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verbraucherpreisindex');
	await expect(page.getByText('Noch keine Werte eingetragen.')).toBeVisible();
	await page.getByLabel('Monat').fill('2025-01');
	await page.getByLabel('Indexwert').fill('121,0');
	await page.getByRole('button', { name: 'Wert eintragen' }).click();
	await expect(page.getByText('Der Wert für Januar 2025 wurde eingetragen.')).toBeVisible();
	await page.getByLabel('Monat').fill('2026-01');
	await page.getByLabel('Indexwert').fill('124,3');
	await page.getByRole('button', { name: 'Wert eintragen' }).click();
	await expect(page.getByText('Der Wert für Januar 2026 wurde eingetragen.')).toBeVisible();
	const values = page.getByRole('table', { name: 'VPI-Werte' });
	await expect(values.getByRole('row')).toHaveCount(3);
	await expect(values.getByRole('row').nth(1)).toContainText('Januar 2026');
	await expect(values.getByRole('row').nth(1)).toContainText('124,3');

	// The Miethöhe tab computes 600,00 × 124,3 ÷ 118,2 = 630,96 €.
	await page.goto(`/vertraege/${leaseId}/miethoehe`);
	await expect(page.getByRole('link', { name: 'Miethöhe' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	const history = page.getByRole('table', { name: 'Mietänderungen' });
	await expect(history.getByRole('row')).toHaveCount(2);
	await expect(history).toContainText('Vertragsbeginn');
	await expect(page.getByText('118,2 (Januar 2024)')).toBeVisible();
	await expect(page.getByText('630,96 €')).toBeVisible();

	await page.getByRole('button', { name: 'Erhöhung vorschlagen' }).click();
	await expect(history.getByRole('row')).toHaveCount(3);
	const proposal = history.getByRole('row').nth(2);
	await expect(proposal).toContainText('630,96 €');
	await expect(proposal).toContainText('Vorschlag');
	await expect(proposal).toContainText('Indexanpassung');
	await expect(proposal).toContainText('124,3 (Januar 2026)');

	// Delivered on 15 October 2026: the new rent applies from 1 December 2026 (§ 557b Abs. 3 BGB).
	await page.getByLabel('Schreiben zugestellt am').fill('2026-10-15');
	await expect(page.getByText('Gilt ab 01.12.2026')).toBeVisible();
	page.once('dialog', (dialog) => {
		// formatCents joins amount and € with a no-break space.
		expect(dialog.message().replace(/\u00a0/g, ' ')).toContain('630,96 € ab 01.12.2026');
		void dialog.accept();
	});
	await page.getByRole('button', { name: 'Erhöhung freigeben' }).click();
	await expect(page.getByText('Die Erhöhung wurde freigegeben')).toBeVisible();
	const approved = history.getByRole('row').nth(2);
	await expect(approved).toContainText('01.12.2026');
	await expect(approved).toContainText('630,96 €');
	await expect(approved).toContainText('830,96 €');
	await expect(approved).toContainText('Freigegeben');
	await expect(page.getByText('Es gibt schon einen Vorschlag')).toHaveCount(0);

	// The letter downloads as a PDF.
	const letterHref = await approved.getByRole('link', { name: 'Brief' }).getAttribute('href');
	expect(letterHref).toBe(`/vertraege/${leaseId}/miethoehe/brief/${letterHref?.split('/').at(-1)}`);
	const letter = await page.request.get(letterHref!);
	expect(letter.status()).toBe(200);
	expect(letter.headers()['content-type']).toContain('application/pdf');
	expect((await letter.body()).subarray(0, 5).toString()).toBe('%PDF-');

	// A manual change of the base rent on an indexed residential lease needs a reason.
	await page.getByLabel('Gültig ab').fill('2027-01-01');
	await page.getByLabel('Kaltmiete', { exact: true }).fill('650,00');
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByText('Bitte begründe die Änderung der Kaltmiete')).toBeVisible();
	await expect(page.getByLabel('Kaltmiete', { exact: true })).toHaveValue('650,00');
	await page.getByLabel('Notiz').fill('Einvernehmlich vereinbart am 01.10.2026.');
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByText('Die Änderung wurde gespeichert.')).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(4);
	const manual = history.getByRole('row').nth(3);
	await expect(manual).toContainText('01.01.2027');
	await expect(manual).toContainText('650,00 €');
	await expect(manual).toContainText('Einvernehmlich vereinbart am 01.10.2026.');
});

test('adds a Staffel step after a confirmation and keeps a later prepayment change', async ({
	page
}) => {
	// A graduated residential lease from 2025-01-01 at 600 € + 150 € + 50 €.
	const { leaseId } = await seedLease(page.request, {
		lease: { rentModel: 'graduated', startDate: '2025-01-01' }
	});
	await page.goto(`/vertraege/${leaseId}/miethoehe`);
	const history = page.getByRole('table', { name: 'Mietänderungen' });
	await expect(history.getByRole('row')).toHaveCount(2);
	const stepFrom = page.getByLabel('Beginn der Staffel');
	const stepRent = page.getByLabel('Neue Kaltmiete');
	const addStep = page.getByRole('button', { name: 'Staffel anlegen' });
	// The confirmation names the new Kaltmiete and its first day (formatCents uses a no-break space).
	const answer = (accept: boolean, expected: string) =>
		page.once('dialog', (dialog) => {
			expect(dialog.message().replace(/\u00a0/g, ' ')).toContain(expected);
			void (accept ? dialog.accept() : dialog.dismiss());
		});

	// Dismissed: nothing is saved.
	await stepFrom.fill('2027-01-01');
	await stepRent.fill('620,00');
	answer(false, 'Staffel ab 01.01.2027 mit Kaltmiete 620,00 € anlegen?');
	await addStep.click();
	await expect(history.getByRole('row')).toHaveCount(2);

	// Less than a year after the start (§ 557a Abs. 2 BGB): refused.
	await stepFrom.fill('2025-12-01');
	answer(true, 'Staffel ab 01.12.2025 mit Kaltmiete 620,00 € anlegen?');
	await addStep.click();
	await expect(
		page.getByRole('alert').getByText('Zwischen zwei Staffeln muss mindestens ein Jahr liegen')
	).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(2);

	// Confirmed: the step is approved at once.
	await stepFrom.fill('2027-01-01');
	answer(true, 'Staffel ab 01.01.2027 mit Kaltmiete 620,00 € anlegen?');
	await addStep.click();
	await expect(page.getByText('Die Staffel wurde angelegt.')).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(3);
	await expect(page.getByRole('list', { name: 'Staffeln' })).toContainText('ab 01.01.2027');

	// A § 560 change of the operating prepayment to 200 € from 01.12.2026, entered after the step:
	// the step keeps its Kaltmiete and takes the new prepayment, 620 + 200 + 50 = 870 €.
	await page.getByLabel('Gültig ab').fill('2026-12-01');
	await page.getByLabel('Kaltmiete', { exact: true }).fill('600,00');
	await page.getByLabel('Betriebskostenvorauszahlung').fill('200,00');
	await page.getByLabel('Grund').selectOption('statement');
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByText('Die Änderung wurde gespeichert.')).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(4);
	const step = history.getByRole('row').filter({ hasText: '01.01.2027' });
	await expect(step).toContainText(/620,00\s€/);
	await expect(step).toContainText(/870,00\s€/);
});

test('answers an unknown lease with 404', async ({ page }) => {
	const response = await page.goto('/vertraege/does-not-exist/miethoehe');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
	// A lease of another account, and its letter route.
	const foreign = await seedForeignLease(page.request);
	expect((await page.goto(`/vertraege/${foreign.leaseId}/miethoehe`))?.status()).toBe(404);
	expect(
		(await page.request.get(`/vertraege/${foreign.leaseId}/miethoehe/brief/unknown`)).status()
	).toBe(404);
});
