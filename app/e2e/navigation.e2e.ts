import { expect, test } from '@playwright/test';
import { today } from '../src/lib/dates';
import { seedLease, seedRows } from './seed';

// Ways out of pages that cannot do something themselves. A payment and a deposit movement that
// came from a bank transaction are undone on /bank, so both link to that one transaction, which
// /bank shows whatever its status (the list defaults to the open ones). Seeded: a lease, a bank
// account and two matched transactions, one booked as rent, one as deposit.

const suffix = crypto.randomUUID().slice(0, 6);

test('links a bank-sourced payment and deposit movement to their transaction on /bank', async ({
	page
}) => {
	const date = today();
	const { leaseId } = await seedLease(page.request, {
		tenant: { lastName: `Umsatzlink-${suffix}` }
	});
	const {
		ids: [bankAccountId]
	} = await seedRows(page.request, 'bankAccounts', [
		{ name: `Linkkonto ${suffix}`, iban: 'DE89370400440532013000', holder: 'Vermieter' }
	]);
	const {
		ids: [rentTransactionId, depositTransactionId]
	} = await seedRows(page.request, 'bankTransactions', [
		{
			bankAccountId,
			bookingDate: date,
			amount: 80000,
			counterpartName: `Miete ${suffix}`,
			purpose: 'Miete',
			fingerprint: `link-rent-${suffix}`,
			status: 'matched'
		},
		{
			bankAccountId,
			bookingDate: date,
			amount: 60000,
			counterpartName: `Kaution ${suffix}`,
			purpose: 'Kaution',
			fingerprint: `link-deposit-${suffix}`,
			status: 'matched'
		}
	]);
	await seedRows(page.request, 'payments', [
		{ leaseId, date, amount: 80000, source: 'bank', bankTransactionId: rentTransactionId }
	]);
	await seedRows(page.request, 'depositTransactions', [
		{ leaseId, date, amount: 60000, kind: 'received', bankTransactionId: depositTransactionId }
	]);

	// The Mietkonto row has no delete button but a link to its transaction.
	await page.goto(`/vertraege/${leaseId}/mietkonto`);
	const ledger = page.getByRole('table', { name: 'Buchungen' });
	await ledger.getByRole('link', { name: 'Umsatz', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/bank\\?umsatz=${rentTransactionId}$`));
	// The transactions themselves, not the assignments listed inside them.
	const listed = page.getByRole('list', { name: 'Umsätze' }).locator(':scope > li');
	await expect(listed).toHaveCount(1);
	await expect(listed).toContainText(`Miete ${suffix}`);
	await expect(listed).toContainText('Zugeordnet');
	await expect(page.getByText('Es wird nur ein Umsatz angezeigt')).toBeVisible();

	// Undoing the assignment there removes the payment from the Mietkonto.
	page.once('dialog', (dialog) => dialog.accept());
	await listed.getByRole('button', { name: 'Zuordnung aufheben' }).click();
	await expect(listed).toContainText('Offen');
	await page.goto(`/vertraege/${leaseId}/mietkonto`);
	await expect(page.getByRole('table', { name: 'Buchungen' })).toBeVisible();
	await expect(
		page.getByRole('table', { name: 'Buchungen' }).getByRole('link', { name: 'Umsatz' })
	).toHaveCount(0);

	// The deposit movement links the same way.
	await page.goto(`/vertraege/${leaseId}/kaution`);
	await page.getByRole('link', { name: 'Umsatz', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/bank\\?umsatz=${depositTransactionId}$`));
	await expect(listed).toHaveCount(1);
	await expect(listed).toContainText(`Kaution ${suffix}`);
	await expect(listed.getByRole('button', { name: 'Zuordnung aufheben' })).toBeVisible();
});
