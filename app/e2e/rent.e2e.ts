import { expect, test } from '@playwright/test';
import { addMonthsToMonth, firstOfMonth, formatDate, monthOf, today } from '../src/lib/dates';
import { clearTables, seedForeignLease, seedLease, seedRows } from './seed';

// The rent feature: VPI values, the index proposal with its approval and letter, and a manual
// change. The lease and the VPI values are seeded; only /einstellungen/vpi and the Miethöhe tab
// are driven. The changes lie in the months after today, so the tests do not age.

/** The first day of the n-th month after the current one. */
const monthsAhead = (months: number) => firstOfMonth(addMonthsToMonth(monthOf(today()), months));

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

	// Two VPI values, as the fetch from Destatis stores them; the newer one counts.
	await seedRows(page.request, 'consumer_price_index', [
		{ month: '2025-01', value: 121, baseYear: '2020' },
		{ month: '2026-01', value: 124.3, baseYear: '2020' }
	]);
	await page.goto('/einstellungen/vpi');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verbraucherpreisindex');
	const values = page.getByRole('table', { name: 'VPI-Werte' });
	await expect(values.getByRole('row')).toHaveCount(3);
	await expect(values.getByRole('row').nth(1)).toContainText('2026');
	await expect(values.getByRole('row').nth(1)).toContainText('124,3');
	await expect(page.getByText('Datenquelle: Statistisches Bundesamt (Destatis)')).toBeVisible();

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
	await expect(proposal).toContainText(/124,3\s*Januar 2026/);

	// Delivered today: the new rent applies from the first day of the second month after it
	// (§ 557b Abs. 3 BGB).
	const effective = formatDate(monthsAhead(2));
	await page.getByLabel('Schreiben zugestellt am').fill(today());
	await expect(page.getByText(`Gilt ab ${effective}`)).toBeVisible();
	page.once('dialog', (dialog) => {
		// formatCents joins amount and € with a no-break space.
		expect(dialog.message().replace(/\u00a0/g, ' ')).toContain(`630,96 € ab ${effective}`);
		void dialog.accept();
	});
	await page.getByRole('button', { name: 'Erhöhung freigeben' }).click();
	await expect(page.getByText('Die Erhöhung wurde freigegeben')).toBeVisible();
	const approved = history.getByRole('row').nth(2);
	await expect(approved).toContainText(effective);
	await expect(approved).toContainText('630,96 €');
	await expect(approved).toContainText('830,96 €');
	await expect(approved).not.toContainText('Vorschlag');
	await expect(page.getByText('Es gibt schon einen Vorschlag')).toHaveCount(0);

	// The letter downloads as a PDF.
	const letterHref = await approved.getByRole('link', { name: 'Brief' }).getAttribute('href');
	expect(letterHref).toBe(`/vertraege/${leaseId}/miethoehe/brief/${letterHref?.split('/').at(-1)}`);
	const letter = await page.request.get(letterHref!);
	expect(letter.status()).toBe(200);
	expect(letter.headers()['content-type']).toContain('application/pdf');
	expect((await letter.body()).subarray(0, 5).toString()).toBe('%PDF-');

	// A manual change of the base rent on an indexed residential lease needs a reason. It starts
	// a month after the index change.
	const manualFrom = monthsAhead(3);
	await page.getByLabel('Gültig ab').fill(manualFrom);
	await page.getByLabel('Kaltmiete', { exact: true }).fill('650,00');
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByText('Bitte begründe die Änderung der Kaltmiete')).toBeVisible();
	await expect(page.getByLabel('Kaltmiete', { exact: true })).toHaveValue('650,00');
	await page.getByLabel('Notiz').fill('Einvernehmlich vereinbart.');
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByText('Die Änderung wurde gespeichert.')).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(4);
	const manual = history.getByRole('row').nth(3);
	await expect(manual).toContainText(formatDate(manualFrom));
	await expect(manual).toContainText('650,00 €');
	await expect(manual).toContainText('Einvernehmlich vereinbart.');
});

test('adds a Staffel step after a confirmation and keeps a later prepayment change', async ({
	page
}) => {
	// A graduated residential lease from 2025-01-01 at 600 € + 150 € + 50 €. The step starts
	// three months ahead, the § 560 change one month before it.
	const stepDate = monthsAhead(3);
	const statementFrom = monthsAhead(2);
	const { leaseId } = await seedLease(page.request, {
		lease: { rentModel: 'graduated', startDate: '2025-01-01' }
	});
	await page.goto(`/vertraege/${leaseId}/miethoehe`);
	// The confirmation needs the enhanced form; a click before hydration posts natively.
	await page.waitForLoadState('networkidle');
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
	await stepFrom.fill(stepDate);
	await stepRent.fill('620,00');
	answer(false, `Staffel ab ${formatDate(stepDate)} mit Kaltmiete 620,00 € anlegen?`);
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
	await stepFrom.fill(stepDate);
	answer(true, `Staffel ab ${formatDate(stepDate)} mit Kaltmiete 620,00 € anlegen?`);
	await addStep.click();
	await expect(page.getByText('Die Staffel wurde angelegt.')).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(3);
	await expect(page.getByRole('list', { name: 'Staffeln' })).toContainText(
		`ab ${formatDate(stepDate)}`
	);

	// A § 560 change of the operating prepayment to 200 € from the month before the step, entered
	// after it: the step keeps its Kaltmiete and takes the new prepayment, 620 + 200 + 50 = 870 €.
	await page.getByLabel('Gültig ab').fill(statementFrom);
	await page.getByLabel('Kaltmiete', { exact: true }).fill('600,00');
	await page.getByLabel('Betriebskostenvorauszahlung').fill('200,00');
	await page.getByLabel('Grund').selectOption('statement');
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByText('Die Änderung wurde gespeichert.')).toBeVisible();
	await expect(history.getByRole('row')).toHaveCount(4);
	const step = history.getByRole('row').filter({ hasText: formatDate(stepDate) });
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
