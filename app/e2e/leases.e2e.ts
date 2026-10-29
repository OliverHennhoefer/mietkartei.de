import { expect, test, type Page } from '@playwright/test';
import { seedForeignLease, seedLease, seedRows } from './seed';

// Leases: the whole life of one lease on the pages this feature owns. Property, unit and
// tenant are seeded as raw rows (the portfolio and tenant pages are not driven here).

const suffix = () => crypto.randomUUID().slice(0, 6);

async function seedUnitAndTenant(page: Page) {
	const s = suffix();
	const property = await seedRows(page.request, 'properties', [
		{ name: `Haus ${s}`, street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' }
	]);
	const unit = await seedRows(page.request, 'units', [
		{ propertyId: property.ids[0], name: `Wohnung ${s}`, kind: 'apartment', floorArea: 64 }
	]);
	const tenant = await seedRows(page.request, 'tenants', [
		{ firstName: 'Erika', lastName: `Vertrag-${s}` }
	]);
	return {
		unitId: unit.ids[0],
		tenantId: tenant.ids[0],
		label: `Wohnung ${s} · Haus ${s}`,
		tenantName: `Erika Vertrag-${s}`
	};
}

test('creates a lease with an opening balance, keeps its history and ends it', async ({ page }) => {
	const { unitId, tenantId, label, tenantName } = await seedUnitAndTenant(page);
	page.on('dialog', (dialog) => dialog.accept());

	// The unit and the tenant come preselected from the query string.
	await page.goto(`/vertraege/neu?unitId=${unitId}&tenantId=${tenantId}`);
	await expect(page.locator('select[name="unitId"]')).toHaveValue(unitId);
	const remove = page.getByRole('button', { name: `${tenantName} entfernen` });
	await expect(remove).toBeVisible();
	// The pill's button works once the page is hydrated; a click before that does nothing.
	await page.waitForLoadState('networkidle');
	// The tenant picker: remove the pill, find the tenant again by part of the name and add it with
	// the keyboard.
	await remove.click();
	await expect(remove).toHaveCount(0);
	const picker = page.getByRole('combobox', { name: 'Mieter', exact: true });
	await picker.fill(tenantName.split(' ')[1].toLowerCase());
	await expect(page.getByRole('option', { name: tenantName })).toBeVisible();
	await picker.press('Enter');
	await expect(remove).toBeVisible();
	await expect(page.locator('input[name="tenantIds"]')).toHaveValue(tenantId);
	await picker.press('Escape');
	await expect(page.getByRole('listbox', { name: 'Mieter' })).toHaveCount(0);
	// Help texts sit behind a (?) at the field title.
	const tip = page.getByRole('tooltip', { name: 'Leer bei unbefristeten Verträgen.' });
	await expect(tip).toBeHidden();
	await page
		.locator('.field', { hasText: 'Vertragsende (optional)' })
		.getByRole('button', { name: 'Hinweis' })
		.click();
	await expect(tip).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(tip).toBeHidden();
	// The start defaults to the first of next month.
	await expect(page.locator('input[name="startDate"]')).toHaveValue(/^\d{4}-\d{2}-01$/);
	await page.getByLabel('Beginn', { exact: true }).fill('2025-01-01');
	// Amounts by name: the hints of other fields mention Kaltmiete and Kaution too.
	await page.locator('input[name="baseRent"]').fill('600,00');
	await page.locator('input[name="operatingCostPrepayment"]').fill('150,00');
	await page.locator('input[name="heatingCostPrepayment"]').fill('50,00');
	await page.locator('input[name="securityDeposit"]').fill('1.800,00');
	await page.locator('input[name="openingBalance"]').fill('120,00');
	await page.getByRole('button', { name: 'Mietvertrag anlegen' }).click();

	// Overview: the current rent is the initial one, 600 € + 150 € + 50 € = 800 €. The lease
	// started in the past, so the ledger starts this month: one full rent (800 €) plus the
	// opening balance (120 €) = 920 € Rückstand, whatever month it is.
	await expect(page).toHaveURL(/\/vertraege\/(?!neu)[^/?]+$/);
	const leaseUrl = page.url();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
	await expect(page.getByText(tenantName)).toHaveCount(3);
	await expect(page.getByLabel('Aktuelle Miete')).toContainText(/800,00\s€/);
	await expect(page.getByLabel('Kaution', { exact: true })).toContainText(/1\.800,00\s€/);
	await expect(page.getByLabel('Saldo')).toContainText('Rückstand');
	await expect(page.getByLabel('Saldo')).toContainText(/920,00\s€/);
	await expect(page.getByText('am 3. Werktag des Monats')).toBeVisible();

	// Persons history: the initial row and one added "ab Datum".
	const persons = page.getByRole('table', { name: 'Personenstand' });
	await expect(persons.getByRole('row')).toHaveCount(2);
	await page.getByLabel('Personen ab Datum').fill('2026-01-01');
	await page.getByLabel('Personen', { exact: true }).fill('3');
	await page.getByLabel('Notiz (optional)').fill('Kind geboren');
	await page.getByRole('button', { name: 'Personenstand eintragen' }).click();
	await expect(persons.getByRole('row')).toHaveCount(3);
	await expect(persons).toContainText('01.01.2026');
	await expect(persons).toContainText('Kind geboren');

	// Edit: a start date on the day of the later persons row is refused with a sentence (not a
	// database error); the due day, the notes and the deposit typed wrong at the start are fixed.
	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	await expect(page.locator('input[name="baseRent"]')).toHaveValue('600,00');
	await expect(page.locator('input[name="securityDeposit"]')).toHaveValue('1.800,00');
	// By name: the label's accessible name takes in the error and hint texts.
	const startDate = page.locator('input[name="startDate"]');
	await startDate.fill('2026-01-01');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(
		page.getByText('Am 01.01.2026 beginnt schon eine spätere Mietänderung')
	).toBeVisible();
	await startDate.fill('2025-01-01');
	await page.getByLabel('Fälligkeit (Werktag des Monats)').fill('5');
	await page.getByLabel('Notizen (optional)').fill('Schlüssel übergeben');
	await page.locator('input[name="securityDeposit"]').fill('1.500,00');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(leaseUrl);
	await expect(page.getByText('Schlüssel übergeben')).toBeVisible();
	await expect(page.getByText('am 5. Werktag des Monats')).toBeVisible();
	await expect(page.getByLabel('Kaution', { exact: true })).toContainText(/1\.500,00\s€/);

	// The added persons row goes again; the first row stays.
	await persons
		.getByRole('row', { name: /01\.01\.2026/ })
		.getByRole('link', { name: '01.01.2026' })
		.click();
	await page
		.getByRole('dialog', { name: 'Personenstand bearbeiten' })
		.getByRole('button', { name: 'Löschen' })
		.click();
	await expect(persons.getByRole('row')).toHaveCount(2);
	await expect(persons).not.toContainText('Kind geboren');

	// Kaution tab: three instalments while nothing is paid in, one movement, the summary. They are
	// due with the first three rents on the fifth working day: January 2025 starts with Neujahr,
	// so Thu 2, Fri 3, Mon 6, Tue 7, Wed 8.
	await page
		.getByRole('navigation', { name: 'Bereiche' })
		.getByRole('link', { name: 'Kaution' })
		.click();
	await expect(page).toHaveURL(`${leaseUrl}/kaution`);
	const instalments = page.getByRole('list', { name: 'Raten' }).getByRole('listitem');
	await expect(instalments).toHaveCount(3);
	await expect(instalments.nth(0)).toContainText('bis 08.01.2025');
	await expect(instalments.nth(1)).toContainText(/500,00\s€/);
	await expect(instalments.nth(1)).toContainText('bis 07.02.2025');
	await expect(instalments.nth(2)).toContainText('bis 07.03.2025');
	await expect(page.getByText('Noch keine Bewegungen.')).toBeVisible();
	await page.getByLabel('Betrag').fill('600,00');
	await page.getByLabel('Notiz (optional)').fill('erste Rate');
	await page.getByRole('button', { name: 'Bewegung buchen' }).click();
	const movements = page.getByRole('table', { name: 'Kautionsbewegungen' });
	await expect(movements.getByRole('row')).toHaveCount(2);
	await expect(movements).toContainText('Erhalten');
	await expect(movements).toContainText('erste Rate');
	await expect(movements).toContainText(/600,00\s€/);
	const outstanding = page
		.getByLabel('Zusammenfassung')
		.locator('.stat', { hasText: 'Noch offen' });
	await expect(outstanding).toContainText(/900,00\s€/);
	await expect(page.getByRole('list', { name: 'Raten' })).toBeVisible();

	// The lease now carries money, so it cannot be deleted, only ended; the page says so.
	await page.goto(leaseUrl);
	await expect(page.getByText(/Kautionsbewegung.*„Vertrag beenden“ beendet/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mietvertrag löschen' })).toHaveCount(0);

	// Vertrag beenden: a tenant's notice received on 2 March 2026 ends the lease on 31 May 2026
	// at the earliest (§ 573c BGB); the form proposes that date, and an earlier one is refused
	// unless it was agreed.
	await page.getByLabel('Kündigung erhalten am').fill('2026-03-02');
	await page.locator('select[name="terminatedBy"]').selectOption('tenant');
	const endDate = page.locator('input[name="endDate"]');
	await expect(endDate).toHaveValue('2026-05-31');
	await endDate.fill('2026-04-30');
	await page.getByRole('button', { name: 'Vertrag beenden' }).click();
	await expect(
		page.getByText(
			'Nach § 573c BGB endet der Vertrag bei dieser Kündigung frühestens am 31.05.2026.'
		)
	).toBeVisible();
	await endDate.fill('2026-05-31');
	await page.getByRole('button', { name: 'Vertrag beenden' }).click();
	const notice = page.getByLabel('Kündigung', { exact: true });
	await expect(notice).toContainText('02.03.2026 durch Mieter');
	await expect(notice).toContainText('31.05.2026');
	const deadlines = page.getByRole('list', { name: 'Fristen' });
	await expect(deadlines).toContainText('Zählerstände ablesen am 31.05.2026');
	await expect(deadlines).toContainText('Kaution abrechnen bis 30.11.2026');
	await expect(deadlines).toContainText('Betriebskostenabrechnung bis 31.12.2027');
	await expect(page.getByRole('button', { name: 'Vertrag beenden' })).toHaveCount(0);

	// The deposit movement booked by mistake goes again: the whole deposit is open.
	await page.goto(`${leaseUrl}/kaution`);
	await movements.getByRole('link').first().click();
	await page
		.getByRole('dialog', { name: 'Bewegung bearbeiten' })
		.getByRole('button', { name: 'Löschen' })
		.click();
	await expect(page.getByText('Noch keine Bewegungen.')).toBeVisible();
	await expect(outstanding).toContainText(/1\.500,00\s€/);

	// The list shows the ended lease after the active ones.
	await page.goto('/vertraege');
	const row = page.getByRole('table', { name: 'Mietverträge' }).getByRole('row', { name: label });
	await expect(row).toContainText('Beendet');
	await expect(row).toContainText('01.01.2025 – 31.05.2026');
	await expect(row).toContainText(/800,00\s€/);
});

test('settles the deposit of an ended lease and writes the letter', async ({ page }) => {
	// 800 € a month through 2025 with one month unpaid at the end and paid since, the deposit of
	// 1.800 € paid in.
	const { leaseId } = await seedLease(page.request, {
		lease: { endDate: '2025-12-31', terminatedAt: '2025-09-15', terminatedBy: 'tenant' }
	});
	await seedRows(page.request, 'payments', [
		{ leaseId, date: '2025-12-01', amount: 880000, note: 'Mieten 2025' },
		{ leaseId, date: '2026-01-15', amount: 80000, note: 'Dezember' }
	]);
	await seedRows(page.request, 'deposit_transactions', [
		{ leaseId, date: '2025-01-02', kind: 'received', amount: 180000 }
	]);
	await page.goto(`/vertraege/${leaseId}/kaution`);

	// Interest of 12 €, a repair withheld and the arrears of 800 € offset leave 712 €.
	await page.getByLabel('Zinsen bis heute (optional)').fill('12,00');
	await page.getByLabel('Grund').fill('Reparatur der Badtür');
	await page.locator('input[name="amount1"]').fill('300,00');
	// Settled today, nothing is owed; on the day of the end, the 800 € were.
	await expect(page.getByLabel(/Mietrückstand von/)).toHaveCount(0);
	await expect(page.locator('.preview')).toContainText(/Auszahlung\s1\.512,00\s€/);
	await page.getByLabel('Datum der Abrechnung').fill('2025-12-31');
	await page.getByLabel('Datum der Abrechnung').dispatchEvent('change');
	await expect(
		page.getByLabel('Mietrückstand von 800,00 € mit der Kaution verrechnen')
	).toBeChecked();
	await expect(page.locator('.preview')).toContainText(/Auszahlung\s712,00\s€/);
	await page.getByRole('button', { name: 'Weiterer Einbehalt' }).click();
	await expect(page.locator('input[name="label2"]')).toBeVisible();
	await page.getByRole('button', { name: 'Kaution abrechnen' }).click();

	await expect(page.getByText(/Abgerechnet am .*712,00\s€/)).toBeVisible();
	const movements = page.getByRole('table', { name: 'Kautionsbewegungen' });
	await expect(movements.getByText('Abrechnung')).toHaveCount(4);
	await expect(movements).toContainText('Einbehalt: Reparatur der Badtür');
	await page.getByRole('link', { name: 'Schreiben ansehen' }).click();
	const letter = page.getByRole('dialog', { name: /Kautionsabrechnung vom/ });
	await expect(letter).toContainText('Ihr Mietverhältnis');
	await expect(letter).toContainText('Verrechnet mit dem Mietrückstand');
	await letter.getByRole('button', { name: 'Vorschau schließen' }).click();

	// Deleting the settlement takes its bookings with it; the form is back.
	page.once('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: 'Abrechnung löschen' }).click();
	await expect(page.getByRole('button', { name: 'Kaution abrechnen' })).toBeVisible();
	await expect(movements.getByRole('row')).toHaveCount(2);
});

test('records the handover at moving in and out and prints the protocol', async ({ page }) => {
	const { leaseId } = await seedLease(page.request, { lease: { endDate: '2025-12-31' } });
	await page.goto(`/vertraege/${leaseId}/uebergabe`);
	await page.getByRole('link', { name: 'Protokoll anlegen' }).first().click();
	await expect(page.locator('input[name="date"]')).toHaveValue('2025-01-01');
	await page.locator('select[name="condition2"]').selectOption('worn');
	await page.locator('input[name="roomNote2"]').fill('Kratzer auf der Arbeitsplatte');
	await page.getByRole('button', { name: 'Protokoll speichern' }).click();
	await expect(page.locator('.protocol').first()).toContainText('Übergabe am 01.01.2025: 5 Räume');

	// The move-out starts from the move-in's rooms; the PDF shows both.
	await page.getByRole('link', { name: 'Protokoll anlegen' }).click();
	await expect(page.locator('input[name="date"]')).toHaveValue('2025-12-31');
	await expect(page.locator('input[name="room2"]')).toHaveValue('Küche');
	await page.locator('select[name="condition3"]').selectOption('damaged');
	await page.locator('input[name="roomNote3"]').fill('Badtür gesplittert');
	// A refusal keeps the form with what was typed, each row in its place.
	const firstKey = page.locator('input[name="key1"]');
	const label = await firstKey.inputValue();
	const count = await page.locator('input[name="keyCount1"]').inputValue();
	await firstKey.fill('');
	await page.getByRole('button', { name: 'Protokoll speichern' }).click();
	await expect(page.getByText('Bitte gib an, wofür der Schlüssel ist.')).toBeVisible();
	await expect(page.locator('input[name="keyCount1"]')).toHaveValue(count);
	await firstKey.fill(label);
	await page.locator('input[name="date"]').fill('2024-12-31');
	await page.getByRole('button', { name: 'Protokoll speichern' }).click();
	await expect(page.getByText('Der Auszug kann nicht vor dem Einzug')).toBeVisible();
	await expect(page.locator('input[name="roomNote3"]')).toHaveValue('Badtür gesplittert');
	await page.locator('input[name="date"]').fill('2025-12-31');
	await page.getByRole('button', { name: 'Protokoll speichern' }).click();
	await expect(page.locator('.protocol').nth(1)).toContainText('Mängel in Bad');
	await expect(page.getByRole('link', { name: 'Protokoll ansehen' }).nth(1)).toHaveAttribute(
		'href',
		`/vertraege/${leaseId}/uebergabe/auszug`
	);
	const printed = await page.request.get(`/vertraege/${leaseId}/uebergabe/auszug`);
	expect(printed.headers()['content-type']).toBe('application/pdf');
});

test('shows validation errors and the deposit hint', async ({ page }) => {
	const { unitId, tenantId } = await seedUnitAndTenant(page);
	await page.goto(`/vertraege/neu?unitId=${unitId}&tenantId=${tenantId}`);
	await page.getByLabel('Beginn', { exact: true }).fill('2026-02-01');
	await page.getByLabel('Vertragsende (optional)').fill('2026-01-31');
	await page.locator('input[name="baseRent"]').fill('600,00');
	await page.locator('input[name="securityDeposit"]').fill('2.000,00');
	await page.getByRole('button', { name: 'Mietvertrag anlegen' }).click();
	await expect(page.getByText('Das Vertragsende liegt vor dem Beginn.')).toBeVisible();
	await expect(
		page.getByText('Die Kaution übersteigt drei Nettokaltmieten (§ 551 BGB).')
	).toBeVisible();
	await expect(page.locator('input[name="baseRent"]')).toHaveValue('600,00');
});

test('proposes the landlord notice period and deletes a lease without money', async ({ page }) => {
	page.on('dialog', (dialog) => dialog.accept());
	// A lease of nine years: a landlord's notice of 2 March 2026 ends it on 30 November 2026
	// (§ 573c Abs. 1 BGB: three plus six months), a tenant's on 31 May 2026.
	const { leaseId } = await seedLease(page.request, { lease: { startDate: '2017-01-01' } });
	await page.goto(`/vertraege/${leaseId}`);
	await page.getByLabel('Kündigung erhalten am').fill('2026-03-02');
	const endDate = page.locator('input[name="endDate"]');
	await expect(endDate).toHaveValue('2026-05-31');
	await page.locator('select[name="terminatedBy"]').selectOption('landlord');
	await expect(endDate).toHaveValue('2026-11-30');
	await expect(page.getByText('Nach § 573c BGB frühestens am 30.11.2026.')).toBeVisible();

	// The lease has no payments or postings, so it can be deleted with its history.
	await page.getByRole('button', { name: 'Mietvertrag löschen' }).click();
	await expect(page).toHaveURL(/\/vertraege$/);
	const response = await page.goto(`/vertraege/${leaseId}`);
	expect(response?.status()).toBe(404);
});

test('answers unknown leases and leases of another account with 404', async ({ page }) => {
	const response = await page.goto('/vertraege/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');

	// Real ids of a second account: every page of the lease and tenant answers 404, and so does
	// a form action.
	const foreign = await seedForeignLease(page.request);
	for (const path of [
		`/vertraege/${foreign.leaseId}`,
		`/vertraege/${foreign.leaseId}/bearbeiten`,
		`/vertraege/${foreign.leaseId}/miethoehe`,
		`/vertraege/${foreign.leaseId}/mietkonto`,
		`/vertraege/${foreign.leaseId}/kaution`,
		`/vertraege/${foreign.leaseId}/dokumente`,
		`/mieter/${foreign.tenantId}`,
		`/mieter/${foreign.tenantId}/bearbeiten`
	]) {
		const answer = await page.goto(path);
		expect(answer?.status(), path).toBe(404);
	}
	const origin = new URL(page.url()).origin;
	const deleted = await page.request.post(`/vertraege/${foreign.leaseId}?/delete`, {
		form: {},
		headers: { origin },
		maxRedirects: 0
	});
	expect(deleted.status()).toBe(404);
	const booked = await page.request.post(`/vertraege/${foreign.leaseId}/mietkonto?/payment`, {
		form: { date: '2025-01-03', amount: '100,00' },
		headers: { origin },
		maxRedirects: 0
	});
	expect(booked.status()).toBe(404);
});

test('records a co-tenant leaving and another joining the lease', async ({ page }) => {
	const { leaseId } = await seedLease(page.request, { lease: { startDate: '2024-01-01' } });
	const s = suffix();
	await seedRows(page.request, 'tenants', [{ firstName: 'Jonas', lastName: `Neu-${s}` }]);

	await page.goto(`/vertraege/${leaseId}`);
	const parties = page.getByRole('table', { name: 'Vertragsparteien' });
	await expect(parties.getByRole('row')).toHaveCount(2);
	await expect(parties.getByRole('row').nth(1)).toContainText('bei Vertragsbeginn');

	// Jonas joins by a Nachtrag on 1 April 2025.
	await page.getByLabel('Mieter tritt ein').selectOption({ label: `Jonas Neu-${s}` });
	await page.getByLabel('Eingetreten am (optional)').fill('2025-04-01');
	await page.getByRole('button', { name: 'Mieter hinzufügen' }).click();
	await expect(parties.getByRole('row')).toHaveCount(3);
	await expect(parties.getByRole('row').nth(2)).toContainText('01.04.2025');

	// The first tenant leaves the day before; leaving a day earlier would leave the flat without a
	// party for a day.
	await parties.getByRole('row').nth(1).getByRole('link', { name: 'Ein-/Austritt' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Ausgetreten am (optional)').fill('2025-03-30');
	await dialog.getByRole('button', { name: 'Speichern' }).click();
	await expect(dialog.getByText('keinen Mieter')).toBeVisible();
	await dialog.getByLabel('Ausgetreten am (optional)').fill('2025-03-31');
	await dialog.getByRole('button', { name: 'Speichern' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(parties.getByRole('row').nth(1)).toContainText('31.03.2025');
	// Today only Jonas is a party.
	await expect(page.locator('dl.details').first()).toContainText(`Jonas Neu-${s}`);
	await expect(page.locator('dl.details').first()).not.toContainText('Erika');
	if (process.env.SCREENSHOT_DIR) {
		await page.getByRole('heading', { name: 'Vertragsparteien' }).scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/parteien.png` });
	}
});
