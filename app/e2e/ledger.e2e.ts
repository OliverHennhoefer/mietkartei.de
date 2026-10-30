import { expect, test, type Page } from '@playwright/test';
import {
	addDays,
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	formatMonth,
	lastOfMonth,
	monthOf,
	today
} from '../src/lib/dates';
import { pdfText } from './pdf-text';
import { seedLease, seedRows } from './seed';

// The ledger pages: /mietkonto with every lease's balance and the Mietkonto tab of one lease.
// The lease is seeded four months back at 600 € + 150 € + 50 €, so five rents of 800 € are due
// (the month it started, the three months after it and the current one): 4.000 € in arrears.

const suffix = crypto.randomUUID().slice(0, 6);
const lastName = `Rückstand-${suffix}`;
const startMonth = monthOf(addMonths(firstOfMonth(monthOf(today())), -4));
const startDate = firstOfMonth(startMonth);

async function balance(page: Page) {
	return page.locator('.balance strong');
}

function confirmNextDialog(page: Page) {
	page.once('dialog', (dialog) => dialog.accept());
}

test('shows arrears, books and deletes a payment and a correction', async ({ page }) => {
	const { leaseId } = await seedLease(page.request, {
		tenant: { lastName },
		lease: { startDate }
	});

	await page.goto('/');
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Mietkonto' })
		.click();
	await expect(page).toHaveURL(/\/mietkonto$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Mietkonto' })).toBeVisible();
	const row = page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: lastName });
	await expect(row).toContainText('4.000,00 €');
	await expect(row).toContainText('Rückstand');
	await expect(row.getByRole('cell').nth(3)).toHaveText(formatMonth(startMonth));

	await page.goto('/mietkonto?filter=rueckstaende');
	await expect(
		page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: lastName })
	).toBeVisible();
	await page
		.getByRole('table', { name: 'Salden' })
		.locator('tr', { hasText: lastName })
		.getByRole('link', { name: 'Mietkonto' })
		.click();
	await expect(page).toHaveURL(new RegExp(`/vertraege/${leaseId}/mietkonto$`));
	await expect(
		page.getByRole('navigation', { name: 'Bereiche' }).getByRole('link', { name: 'Mietkonto' })
	).toHaveAttribute('aria-current', 'page');

	await expect(page.getByRole('heading', { level: 2, name: 'Mietkonto' })).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo −4.000,00 € Rückstand');
	const ledger = page.getByRole('table', { name: 'Buchungen' });
	const firstRent = ledger.locator('tr', { hasText: `Miete ${formatMonth(startMonth)}` });
	await expect(firstRent).toContainText('800,00 €');
	// Rent rows follow from the lease and cannot be deleted here.
	await expect(firstRent.getByRole('button')).toHaveCount(0);

	// The payment form proposes the open balance; the tenant pays one Gesamtmiete.
	const paymentForm = page.getByRole('form', { name: 'Zahlung buchen' });
	await expect(paymentForm.getByLabel('Betrag in €')).toHaveValue('4.000,00');
	await paymentForm.getByLabel('Betrag in €').fill('0');
	await paymentForm.getByRole('button', { name: 'Zahlung buchen' }).click();
	await expect(paymentForm.getByText('Der Betrag darf nicht 0 sein.')).toBeVisible();

	await paymentForm.getByLabel('Betrag in €').fill('800,00');
	await paymentForm.getByLabel('Vermerk (optional)').fill(`Überweisung ${suffix}`);
	await paymentForm.getByRole('button', { name: 'Zahlung buchen' }).click();
	await expect(page.getByText('Zahlung gebucht.')).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo −3.200,00 € Rückstand');
	// "Wie letzte Zahlung" repeats the amount and the note of the payment just booked.
	await paymentForm.getByRole('button', { name: 'Wie letzte Zahlung' }).click();
	await expect(paymentForm.getByLabel('Betrag in €')).toHaveValue('800,00');
	await expect(paymentForm.getByLabel('Vermerk (optional)')).toHaveValue(`Überweisung ${suffix}`);
	await page.reload();
	const paymentRow = ledger.locator('tr', { hasText: `Überweisung ${suffix}` });
	await expect(paymentRow).toContainText('800,00 €');
	await expect(paymentForm.getByLabel('Betrag in €')).toHaveValue('3.200,00');

	// A credit of 200 € as a correction: chosen as Gutschrift, typed without a sign.
	const adjustmentForm = page.getByRole('form', { name: 'Korrektur oder Anfangssaldo' });
	await adjustmentForm.getByLabel('Art').selectOption('credit');
	await adjustmentForm.getByLabel('Betrag in €').fill('200');
	await adjustmentForm.getByLabel('Vermerk').fill(`Mietminderung ${suffix}`);
	await adjustmentForm.getByRole('button', { name: 'Korrektur buchen' }).click();
	await expect(page.getByText('Korrektur gebucht.')).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo −3.000,00 € Rückstand');
	const adjustmentRow = ledger.locator('tr', { hasText: `Mietminderung ${suffix}` });
	await expect(adjustmentRow).toContainText(`Korrektur ${formatMonth(monthOf(today()))}`);
	// It stands in Haben, without a sign.
	await expect(adjustmentRow.getByRole('cell').nth(2)).toHaveText('');
	await expect(adjustmentRow.getByRole('cell').nth(3)).toHaveText('200,00 €');

	// Only the month the lease started: one rent, nothing else.
	await page.getByLabel('von').fill(startMonth);
	await page.getByLabel('bis').fill(startMonth);
	await page.getByRole('button', { name: 'Anzeigen' }).click();
	await expect(page).toHaveURL(new RegExp(`from=${startMonth}&to=${startMonth}`));
	await expect(ledger.locator('tbody tr')).toHaveCount(1);
	await expect(ledger).toContainText(`Miete ${formatMonth(startMonth)}`);
	await expect(await balance(page)).toHaveText('Saldo −3.000,00 € Rückstand');

	// Back to the default months. The date opens a booking in a dialog: change the correction,
	// then delete it and the payment there.
	await page.goto(`/vertraege/${leaseId}/mietkonto`);
	await adjustmentRow.getByRole('link').first().click();
	const correction = page.getByRole('dialog', { name: 'Korrektur bearbeiten' });
	await expect(correction.getByLabel('Vermerk')).toHaveValue(`Mietminderung ${suffix}`);
	await expect(correction.getByLabel('Art')).toHaveValue('credit');
	await expect(correction.getByLabel('Betrag in €')).toHaveValue('200,00');
	await correction.getByLabel('Betrag in €').fill('150');
	await correction.getByRole('button', { name: 'Speichern' }).click();
	await expect(correction).toBeHidden();
	await expect(adjustmentRow).toContainText('150,00 €');
	await expect(await balance(page)).toHaveText('Saldo −3.050,00 € Rückstand');

	await adjustmentRow.getByRole('link').first().click();
	confirmNextDialog(page);
	await correction.getByRole('button', { name: 'Löschen' }).click();
	await expect(adjustmentRow).toHaveCount(0);
	await expect(await balance(page)).toHaveText('Saldo −3.200,00 € Rückstand');

	await paymentRow.getByRole('link').first().click();
	confirmNextDialog(page);
	await page
		.getByRole('dialog', { name: 'Zahlung bearbeiten' })
		.getByRole('button', { name: 'Löschen' })
		.click();
	await expect(await balance(page)).toHaveText('Saldo −4.000,00 € Rückstand');
	await expect(paymentRow).toHaveCount(0);
});

test('shows a charge that is not due yet without counting it as Rückstand', async ({ page }) => {
	// A lease that starts next month has no rent yet; a posting due in 30 days is all it owes.
	const later = `Spaeter-${suffix}`;
	const { leaseId } = await seedLease(page.request, {
		tenant: { lastName: later },
		lease: { startDate: firstOfMonth(monthOf(addMonths(firstOfMonth(monthOf(today())), 1))) }
	});
	const dueDate = addDays(today(), 30);
	await seedRows(page.request, 'rentCharges', [
		{ leaseId, kind: 'adjustment', period: monthOf(dueDate), dueDate, amount: 12500, note: 'Test' }
	]);

	await page.goto('/mietkonto');
	const row = page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: later });
	await expect(row).toContainText('125,00 €');
	await expect(row).toContainText('noch nicht fällig');
	await expect(row).not.toContainText('Rückstand');
	await expect(row.getByRole('cell').nth(3)).toHaveText('–');

	await page.goto('/mietkonto?filter=rueckstaende');
	await expect(
		page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: later })
	).toHaveCount(0);
});

test('shows a Guthaben and the Rückstand side by side when a later payment overpays', async ({
	page
}) => {
	// Two months that ended last month, 1.600 € due and unpaid; 2.000 € are booked for a date in
	// ten days. The balance is a Guthaben of 400 €, yet 1.600 € are overdue today.
	const ahead = `Vorab-${suffix}`;
	const current = monthOf(today());
	const { leaseId } = await seedLease(page.request, {
		tenant: { lastName: ahead },
		lease: {
			startDate: firstOfMonth(addMonthsToMonth(current, -2)),
			endDate: lastOfMonth(addMonthsToMonth(current, -1))
		}
	});
	await seedRows(page.request, 'payments', [
		{ leaseId, date: addDays(today(), 10), amount: 200000, note: 'Vorauszahlung' }
	]);

	await page.goto('/mietkonto?filter=rueckstaende');
	const row = page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: ahead });
	const saldo = row.getByRole('cell').nth(2);
	await expect(saldo).toContainText('400,00 €');
	await expect(saldo).toContainText('Guthaben');
	await expect(saldo).toContainText('Rückstand');
	await expect(saldo).toContainText('fällig −1.600,00 €');
	await expect(saldo).not.toContainText('davon');
});

test('makes the rent due on the third working day after a public holiday', async ({ page }) => {
	// October 2025: Wed 1, Thu 2, Fri 3 is Tag der Deutschen Einheit, so the third working day is
	// Monday 6 October.
	const { leaseId } = await seedLease(page.request, {
		tenant: { lastName: `Feiertag-${suffix}` },
		lease: { startDate: '2025-10-01', endDate: '2025-10-31' }
	});
	await page.goto(`/vertraege/${leaseId}/mietkonto?from=2025-10&to=2025-10`);
	// The ledger books the rent on the first of the month; the open items show when it fell due.
	const rent = page
		.getByRole('table', { name: 'Buchungen' })
		.locator('tr', { hasText: 'Miete Oktober 2025' });
	await expect(rent.getByRole('cell').first()).toHaveText('01.10.2025');
	const open = page
		.getByRole('table', { name: 'Offene Posten' })
		.locator('tr', { hasText: 'Miete Oktober 2025' });
	await expect(open.getByRole('cell').first()).toHaveText('06.10.2025');
});

test('writes a Zahlungserinnerung, suggests a Mahnung next and lists it with the arrears', async ({
	page
}) => {
	// Two months of 800 €, both overdue and unpaid.
	const reminded = `Erinnert-${suffix}`;
	const { leaseId } = await seedLease(page.request, {
		tenant: { lastName: reminded },
		lease: { startDate: '2025-10-01', endDate: '2025-11-30' }
	});
	await page.goto('/mietkonto?filter=rueckstaende');
	const row = page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: reminded });
	await expect(row).toContainText('noch nicht');
	await row.getByRole('link', { name: 'Erinnern' }).click();
	await expect(page).toHaveURL(new RegExp(`/vertraege/${leaseId}/mietkonto#zahlungserinnerung$`));

	await expect(page.getByRole('table', { name: 'Offene Posten' })).toContainText(
		'Miete Oktober 2025'
	);
	const form = page.getByRole('form', { name: 'Zahlungserinnerung erstellen' });
	await expect(form.getByLabel('Art des Schreibens')).toHaveValue('1');
	await expect(form.getByLabel('Zahlungsfrist')).toHaveValue(addDays(today(), 14));
	await form.getByRole('button', { name: 'Schreiben erstellen' }).click();
	await expect(page.getByText('Schreiben erstellt.')).toBeVisible();

	const letters = page.getByRole('table', { name: 'Erstellte Schreiben' });
	await expect(letters).toContainText('Zahlungserinnerung');
	await expect(letters).toContainText('1.600,00 €');
	const view = letters.getByRole('link', { name: 'Ansehen' });
	const href = await view.getAttribute('href');
	const pdf = await page.request.get(href!);
	expect(pdf.status()).toBe(200);
	expect(pdf.headers()['content-type']).toContain('application/pdf');
	// The preview shows the letter as a sheet whose paragraphs are edited where they stand; the
	// PDF is made from the saved text.
	await view.click();
	const preview = page.getByRole('dialog', { name: /^Zahlungserinnerung vom / });
	const sheet = preview.getByRole('article', { name: /^Zahlungserinnerung zum Mietkonto/ });
	await expect(sheet).toContainText('Miete November 2025');
	await expect(preview.getByRole('link', { name: 'Herunterladen' })).toHaveAttribute('href', href!);
	const paragraph = sheet.getByLabel('Absatz 3');
	await paragraph.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(' Eine Ratenzahlung ist möglich.');
	await preview.getByRole('button', { name: 'Speichern' }).click();
	await expect(preview.getByText('Zum Ändern in den Text klicken')).toBeVisible();
	await expect(paragraph).toContainText('Eine Ratenzahlung ist möglich.');
	await preview.getByRole('button', { name: 'Vorschau schließen' }).click();
	await expect(preview).toBeHidden();
	const edited = (await pdfText(await (await page.request.get(href!)).body())).replace(/\s+/g, ' ');
	expect(edited).toContain('Eine Ratenzahlung ist möglich.');

	// A changed text asks before it is thrown away.
	await view.click();
	await sheet.getByLabel('Absatz 1').click();
	await page.keyboard.type('Hallo ');
	page.once('dialog', (dialog) => dialog.dismiss());
	await preview.getByRole('button', { name: 'Vorschau schließen' }).click();
	await expect(preview).toBeVisible();
	await preview.getByRole('button', { name: 'Verwerfen' }).click();
	await preview.getByRole('button', { name: 'Vorschau schließen' }).click();
	await expect(preview).toBeHidden();
	const text = (await pdfText(await pdf.body())).replace(/\s+/g, ' ');
	expect(text).toContain('Zahlungserinnerung zum Mietkonto');
	expect(text).toContain('Miete November 2025');

	// The next letter about the same Rückstand is a Mahnung.
	await page.reload();
	await expect(form.getByLabel('Art des Schreibens')).toHaveValue('2');
	await page.goto('/mietkonto?filter=rueckstaende');
	await expect(row).toContainText(/Erinnerung\s+\d{2}\.\d{2}\. · Frist bis \d{2}\.\d{2}\./);
	await expect(row.getByRole('link', { name: 'Mahnen' })).toBeVisible();
	// The tenant list shows the Rückstand and the latest letter sent about it.
	await page.goto('/mieter');
	const pills = page
		.getByRole('table', { name: 'Mieter' })
		.locator('tr', { hasText: reminded })
		.locator('.badge');
	await expect(pills).toHaveText(['Rückstand', /Zahlungserinnerung vom \d{2}\.\d{2}\.\d{4}$/]);

	await page.goto(`/vertraege/${leaseId}/mietkonto`);
	await letters.getByRole('link').first().click();
	confirmNextDialog(page);
	await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
	await expect(letters).toHaveCount(0);
});

test('answers an unknown lease with 404', async ({ page }) => {
	const response = await page.goto('/vertraege/does-not-exist/mietkonto');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
