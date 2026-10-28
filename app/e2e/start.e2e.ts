import { expect, test, type Page } from '@playwright/test';
import { addMonths, firstOfMonth, monthOf, today } from '../src/lib/dates';
import { parseCents } from '../src/lib/money';
import { nthWorkingDay } from '../src/lib/working-days';
import { seedLease, seedRows } from './seed';

// The start page is Aufgaben: the overview at the top links the arrears and the open bank
// transactions, and below the own tasks "Leerstand" lists the vacant units. Other tests share the owner's account, so the test reads
// the list, seeds, and asserts the exact increase. The first seed (a bank account and a lease that
// starts next month) makes sure the first-run checklist is gone even when this file runs alone.

const suffix = crypto.randomUUID().slice(0, 6);
const currentMonth = firstOfMonth(monthOf(today()));
const startDate = firstOfMonth(monthOf(addMonths(currentMonth, -2)));
const nextMonth = firstOfMonth(monthOf(addMonths(currentMonth, 1)));
// The seeded rent falls due on the third working day, so the current month's rent is overdue
// only from then on.
const dueRents = nthWorkingDay(monthOf(currentMonth), 3, null) <= today() ? 3 : 2;
// Sorts before every other test's property, so its vacant unit is among the five listed.
const propertyName = `AAA Leerstand ${suffix}`;

type Attention = { arrears: number; arrearsCount: number; unmatched: number };

/** A whole number in a text (German thousands separator), or 0 when the row is missing. */
function whole(text: string | undefined, pattern: RegExp): number {
	const match = text === undefined ? undefined : pattern.exec(text)?.[1];
	return match === undefined ? 0 : Number(match.replace(/\./g, ''));
}

async function readAttention(page: Page): Promise<Attention> {
	await page.goto('/');
	await expect(page).toHaveURL(/\/aufgaben$/);
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toHaveCount(0);
	const items = page.getByRole('region', { name: 'Überblick' }).getByRole('link');
	const arrearsRow = items.filter({ hasText: 'Rückstände bei' });
	const hasArrears = (await arrearsRow.count()) > 0;
	const unmatchedRow = items.filter({ hasText: /offene[rn]? Bankums/ });
	return {
		arrears: hasArrears
			? (parseCents(await arrearsRow.locator('.money').innerText()) ?? Number.NaN)
			: 0,
		arrearsCount: whole(
			hasArrears ? await arrearsRow.innerText() : undefined,
			/bei\s([\d.]+)\sMietvertr/
		),
		unmatched: whole(
			(await unmatchedRow.count()) > 0 ? await unmatchedRow.innerText() : undefined,
			/([\d.]+)\soffene/
		)
	};
}

test('starts on Aufgaben with arrears, open bank transactions and vacant units', async ({
	page
}) => {
	const {
		ids: [bankAccountId]
	} = await seedRows(page.request, 'bankAccounts', [
		{ name: `Startkonto ${suffix}`, iban: 'DE93100000001234567891', holder: 'Vermieter' }
	]);
	// Commercial and without deposit: a lease like this brings no deadline of its own.
	await seedLease(page.request, {
		tenant: { lastName: `Künftig-${suffix}` },
		lease: { startDate: nextMonth, kind: 'commercial', securityDeposit: 0 }
	});

	const before = await readAttention(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Aufgaben' })).toBeVisible();
	const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
	await expect(navigation.getByRole('link', { name: 'Aufgaben' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(navigation.getByRole('link', { name: 'Übersicht' })).toHaveCount(0);

	// Two months back without a payment: the rents of 600 € + 150 € + 50 € of the month it started
	// and the one after are due, and the current one from its due date. A statement's Nachzahlung
	// that has not reached the tenant yet has no due date and is no Rückstand. The property gets a
	// second, empty unit, which is vacant. One open bank transaction.
	const { propertyId, leaseId } = await seedLease(page.request, {
		property: { name: propertyName },
		tenant: { lastName: `Rückstand-${suffix}` },
		lease: { startDate, kind: 'commercial', securityDeposit: 0 }
	});
	await seedRows(page.request, 'rentCharges', [
		{
			leaseId,
			period: monthOf(currentMonth),
			dueDate: null,
			amount: 31000,
			kind: 'statement_balance'
		}
	]);
	await seedRows(page.request, 'units', [
		{ propertyId, name: `Leer-${suffix}`, kind: 'apartment', floorArea: 48 }
	]);
	await seedRows(page.request, 'bankTransactions', [
		{
			bankAccountId,
			bookingDate: today(),
			amount: 12345,
			counterpartName: `Eingang ${suffix}`,
			purpose: 'Unbekannte Gutschrift',
			fingerprint: `start-${suffix}`
		}
	]);

	const after = await readAttention(page);
	expect(after).toEqual({
		arrears: before.arrears + dueRents * 80000,
		arrearsCount: before.arrearsCount + 1,
		unmatched: before.unmatched + 1
	});

	const overview = page.getByRole('region', { name: 'Überblick' }).getByRole('link');
	await expect(overview.filter({ hasText: 'Rückstände bei' })).toHaveAttribute(
		'href',
		'/mietkonto?filter=rueckstaende'
	);
	await expect(overview.filter({ hasText: /offene[rn]? Bankums/ })).toHaveAttribute(
		'href',
		'/bank'
	);

	// The vacant unit is listed with a link into the lease form, preselected.
	const vacant = page
		.getByRole('list', { name: 'Leerstand' })
		.getByRole('listitem')
		.filter({ hasText: `Leer-${suffix}` });
	await expect(vacant).toBeVisible();
	await vacant.getByRole('link', { name: 'Mietvertrag anlegen' }).click();
	await expect(page).toHaveURL(/\/vertraege\/neu\?unitId=/);
	const unit = page.getByRole('combobox', { name: 'Einheit', exact: true });
	await expect(unit.locator('option:checked')).toHaveText(new RegExp(`Leer-${suffix}`));
});
