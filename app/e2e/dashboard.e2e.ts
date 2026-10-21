import { expect, test, type Page } from '@playwright/test';
import { addMonths, firstOfMonth, monthOf, today } from '../src/lib/dates';
import { parseCents } from '../src/lib/money';
import { seedLease, seedRows } from './seed';

// The dashboard: the tiles link to their lists and count what the account holds. Other tests
// share the owner's account, so the test reads the tiles, seeds, and asserts the exact increase.
// The first seed (a bank account and a lease that starts next month) makes sure the tiles show
// instead of the first-run checklist even when this file runs alone; nothing seeded after the
// first reading touches it.

const suffix = crypto.randomUUID().slice(0, 6);
const currentMonth = firstOfMonth(monthOf(today()));
const startDate = firstOfMonth(monthOf(addMonths(currentMonth, -2)));
const nextMonth = firstOfMonth(monthOf(addMonths(currentMonth, 1)));
// Sorts before every other test's property, so its vacant unit is among the five listed.
const propertyName = `AAA Übersicht ${suffix}`;

type Tiles = {
	arrears: number;
	arrearsCount: number;
	vacant: number;
	units: number;
	unmatched: number;
	todo: number;
	overdue: number;
	openTasks: number;
	upcoming: number;
};

/** A whole number shown on a tile (German thousands separator), or the group of a pattern. */
function whole(text: string, pattern?: RegExp): number {
	const match = pattern ? pattern.exec(text)?.[1] : text;
	if (match === undefined) throw new Error(`„${text}“ does not match ${pattern}`);
	return Number(match.replace(/\./g, ''));
}

async function readTiles(page: Page): Promise<Tiles> {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Erste Schritte' })).toHaveCount(0);
	const tiles = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(tiles).toHaveCount(4);
	const value = async (index: number) =>
		(await tiles.nth(index).locator('.value').innerText()).trim();
	const label = async (index: number) =>
		(await tiles.nth(index).locator('.label').innerText()).trim();
	const tasks = await label(3);
	return {
		arrears: parseCents(await value(0)) ?? Number.NaN,
		arrearsCount: whole(await label(0), /([\d.]+)\sMietvertr/),
		vacant: whole(await value(1)),
		units: whole(await label(1), /von\s([\d.]+)\sEinheit/),
		unmatched: whole(await value(2)),
		todo: whole(await value(3)),
		overdue: whole(tasks, /([\d.]+)\süberfällige/),
		openTasks: whole(tasks, /([\d.]+)\soffene Aufgabe/),
		upcoming: whole(tasks, /([\d.]+)\sFristen? in den nächsten 12 Monaten/)
	};
}

test('shows the tiles with arrears, vacancy, open transactions and deadlines', async ({ page }) => {
	const {
		ids: [bankAccountId]
	} = await seedRows(page.request, 'bankAccounts', [
		{ name: `Übersichtskonto ${suffix}`, iban: 'DE02120300000000202051', holder: 'Vermieter' }
	]);
	// Commercial and without deposit: a lease like this brings no deadline of its own.
	await seedLease(page.request, {
		tenant: { lastName: `Künftig-${suffix}` },
		lease: { startDate: nextMonth, kind: 'commercial', securityDeposit: 0 }
	});

	const before = await readTiles(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
	await expect(page).toHaveTitle('Übersicht · mietkartei');

	// Two months back without a payment: three rents of 600 € + 150 € + 50 € are due (the month
	// it started, the one after and the current one), 2.400 € in arrears. The property gets a
	// second, empty unit, which is vacant. One open bank transaction and one open task.
	const { propertyId } = await seedLease(page.request, {
		property: { name: propertyName },
		tenant: { lastName: `Übersicht-${suffix}` },
		lease: { startDate, kind: 'commercial', securityDeposit: 0 }
	});
	await seedRows(page.request, 'units', [
		{ propertyId, name: `Leer-${suffix}`, kind: 'apartment', floorArea: 48 }
	]);
	await seedRows(page.request, 'bankTransactions', [
		{
			bankAccountId,
			bookingDate: today(),
			amount: 12345,
			counterpartName: `Übersicht ${suffix}`,
			purpose: 'Unbekannte Gutschrift',
			fingerprint: `dashboard-${suffix}`
		}
	]);
	await seedRows(page.request, 'tasks', [{ title: `Übersichtsaufgabe ${suffix}` }]);

	const after = await readTiles(page);
	expect(after).toEqual({
		arrears: before.arrears + 240000,
		arrearsCount: before.arrearsCount + 1,
		vacant: before.vacant + 1,
		units: before.units + 2,
		unmatched: before.unmatched + 1,
		todo: before.todo + 1,
		overdue: before.overdue,
		openTasks: before.openTasks + 1,
		upcoming: before.upcoming
	});
	// The big number of the last tile is what there is to do: overdue deadlines and open tasks.
	expect(after.todo).toBe(after.overdue + after.openTasks);

	const tiles = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(tiles.nth(0)).toContainText('Rückstände');
	await expect(tiles.nth(0).getByRole('link')).toHaveAttribute(
		'href',
		'/mietkonto?filter=rueckstaende'
	);
	await expect(tiles.nth(1)).toContainText('Leerstand');
	await expect(tiles.nth(1).getByRole('link')).toHaveAttribute('href', '/objekte');
	await expect(tiles.nth(2)).toContainText(/offene[rn]? Bankums/);
	await expect(tiles.nth(2).getByRole('link')).toHaveAttribute('href', '/bank');
	await expect(tiles.nth(3)).toContainText('in den nächsten 12 Monaten');
	await expect(tiles.nth(3).getByRole('link')).toHaveAttribute('href', '/aufgaben');

	// The vacant unit is listed with a link into the lease form, preselected.
	const vacant = page
		.getByRole('list', { name: 'Leer stehende Einheiten' })
		.getByRole('listitem')
		.filter({ hasText: `Leer-${suffix}` });
	await expect(vacant).toBeVisible();
	await vacant.getByRole('link', { name: 'Mietvertrag anlegen' }).click();
	await expect(page).toHaveURL(/\/vertraege\/neu\?unitId=/);
	const unit = page.getByRole('combobox', { name: 'Einheit', exact: true });
	await expect(unit.locator('option:checked')).toHaveText(new RegExp(`Leer-${suffix}`));
});
