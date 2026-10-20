import { expect, test, type Page } from '@playwright/test';
import { addMonths, firstOfMonth, formatMonth, monthOf, today } from '../src/lib/dates';
import { seedLease } from './seed';

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

	await page.goto('/mietkonto');
	await expect(page.getByRole('heading', { level: 1, name: 'Mietkonto' })).toBeVisible();
	const row = page.getByRole('table', { name: 'Salden' }).locator('tr', { hasText: lastName });
	await expect(row).toContainText('4.000,00 €');
	await expect(row).toContainText('Rückstand');
	await expect(row).toContainText(`offen seit ${formatMonth(startMonth)}`);

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

	await expect(page.getByRole('heading', { level: 2, name: 'Mietkonto' })).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo: Rückstand 4.000,00 €');
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
	await expect(await balance(page)).toHaveText('Saldo: Rückstand 3.200,00 €');
	const paymentRow = ledger.locator('tr', { hasText: `Überweisung ${suffix}` });
	await expect(paymentRow).toContainText('800,00 €');
	await expect(paymentForm.getByLabel('Betrag in €')).toHaveValue('3.200,00');

	// A credit of 200 € as a correction.
	const adjustmentForm = page.getByRole('form', { name: 'Buchung' });
	await adjustmentForm.getByLabel('Betrag in €').fill('-200');
	await adjustmentForm.getByLabel('Vermerk').fill(`Mietminderung ${suffix}`);
	await adjustmentForm.getByRole('button', { name: 'Buchen' }).click();
	await expect(page.getByText('Buchung gebucht.')).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo: Rückstand 3.000,00 €');
	const adjustmentRow = ledger.locator('tr', { hasText: `Mietminderung ${suffix}` });
	await expect(adjustmentRow).toContainText(`Korrektur ${formatMonth(monthOf(today()))}`);
	await expect(adjustmentRow).toContainText('-200,00 €');

	// Only the month the lease started: one rent, nothing else.
	await page.getByLabel('von').fill(startMonth);
	await page.getByLabel('bis').fill(startMonth);
	await page.getByRole('button', { name: 'Anzeigen' }).click();
	await expect(page).toHaveURL(new RegExp(`from=${startMonth}&to=${startMonth}`));
	await expect(ledger.locator('tbody tr')).toHaveCount(1);
	await expect(ledger).toContainText(`Miete ${formatMonth(startMonth)}`);
	await expect(await balance(page)).toHaveText('Saldo: Rückstand 3.000,00 €');

	// Back to the default months; delete the correction, then the payment.
	await page.goto(`/vertraege/${leaseId}/mietkonto`);
	confirmNextDialog(page);
	await adjustmentRow.getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByText('Buchung gelöscht.')).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo: Rückstand 3.200,00 €');
	await expect(adjustmentRow).toHaveCount(0);

	confirmNextDialog(page);
	await paymentRow.getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByText('Zahlung gelöscht.')).toBeVisible();
	await expect(await balance(page)).toHaveText('Saldo: Rückstand 4.000,00 €');
	await expect(paymentRow).toHaveCount(0);
});

test('answers an unknown lease with 404', async ({ page }) => {
	const response = await page.goto('/vertraege/does-not-exist/mietkonto');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
});
