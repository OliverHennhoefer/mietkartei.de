import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { pdfText } from './pdf-text';
import { seedForeignLease, seedLease, seedRows } from './seed';

/** Today in Germany as YYYY-MM-DD, the same day the server's today() returns. */
function berlinToday(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** `2027-03-31` → `31.03.2027`. */
function german(day: string): string {
	return day.split('-').reverse().join('.');
}

/** The PDF's text with every run of whitespace (line breaks of wrapped cells, NBSP) as one space. */
async function pdfOf(page: Page, href: string): Promise<string> {
	const response = await page.request.get(href);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/pdf');
	return (await pdfText(await response.body())).replace(/\s+/g, ' ');
}

async function submitPeriod(page: Page, propertyId: string, start: string, end: string) {
	await page.goto('/betriebskosten');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Betriebskosten');
	await page.getByLabel('Objekt').selectOption({ value: propertyId });
	await page.getByLabel('Zeitraum von').fill(start);
	await page.getByLabel('Zeitraum bis').fill(end);
	await page.getByRole('button', { name: 'Entwurf erstellen' }).click();
}

async function createDraft(page: Page, propertyId: string, start: string, end: string) {
	await submitPeriod(page, propertyId, start, end);
	await expect(page).toHaveURL(/\/betriebskosten\/abrechnungen\/[0-9a-f-]{36}$/);
	await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
	return page.url().split('/').pop()!;
}

async function approve(page: Page) {
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: /^Freigeben: / }).click();
	await expect(page.getByText('auf den Mietkonten gebucht')).toBeVisible();
}

// One property with one apartment of 72,5 m² rented all of last year at 600 € rent plus 150 + 50 €
// prepayments, a Grundsteuer of 3.000 € by area and 500 € of non-allocable administration. The
// tenant paid the rent of January to November, not December's: the statement credits the 11 × 200
// = 2.200 € prepayments paid, a Nachzahlung of 800 €. December's 200 € are still open on the rent
// account, so 600 € are posted. The period is the last calendar year, as "Neue Abrechnung"
// suggests, so the approval always falls within the § 556 Abs. 3 BGB deadline.
test('creates, approves, prints and corrects a statement', async ({ page }) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	const today = berlinToday();
	const year = Number(today.slice(0, 4)) - 1;
	const start = `${year}-01-01`;
	const end = `${year}-12-31`;
	const { propertyId, leaseId } = await seedLease(page.request, {
		unit: { name: `Wohnung EG ${suffix}`, floorArea: 72.5 },
		lease: { startDate: start, persons: 2 }
	});
	const {
		ids: [categoryId]
	} = await seedRows(page.request, 'costCategories', [
		{ name: `Grundsteuer ${suffix}`, betrkvItem: 1, allocable: true, allocationKeyId: null }
	]);
	const {
		ids: [keyId]
	} = await seedRows(page.request, 'allocationKeys', [
		{ name: `Wohnfläche ${suffix}`, kind: 'area' }
	]);
	const costItem = (description: string, amount: number, allocable = true) => ({
		propertyId,
		categoryId,
		allocationKeyId: keyId,
		description: `${description} ${suffix}`,
		periodStart: start,
		periodEnd: end,
		amount,
		allocable
	});
	await seedRows(page.request, 'costItems', [
		costItem(`Grundsteuer ${year}`, 300000),
		costItem('Hausverwaltung', 50000, false)
	]);
	await seedRows(page.request, 'payments', [{ leaseId, date: end, amount: 11 * 80000 }]);

	// A period that cuts a month is refused: it would count both cut months' prepayments in full.
	await submitPeriod(page, propertyId, `${year}-01-15`, `${year + 1}-01-14`);
	await expect(page.getByText('am Ersten eines Monats beginnen')).toBeVisible();

	// The draft.
	const statementId = await createDraft(page, propertyId, start, end);
	await expect(page.locator('.stats')).toContainText('Gesamtkosten');
	const lease = page.getByRole('region', { name: `Mietvertrag Wohnung EG ${suffix}` });
	await expect(lease).toContainText('72,5 m² von 72,5 m²');
	await expect(lease).toContainText('3.000,00 €');
	await expect(lease).toContainText('Geleistete Vorauszahlungen 2.200,00 €');
	await expect(lease).toContainText('Nachzahlung 800,00 €');
	await expect(lease).toContainText('Darin 200,00 € nicht geleistete Vorauszahlungen');
	// The non-allocable item is listed, but not allocated.
	await expect(page.getByRole('table', { name: 'Belege' })).toContainText('nicht umlagefähig');

	// An overlapping period would settle half of the year twice.
	await submitPeriod(page, propertyId, `${year}-07-01`, `${year + 1}-06-30`);
	await expect(page.getByText(`überschneidet sich mit der Abrechnung ${year}`)).toBeVisible();

	// The approval posts the Nachzahlung; it falls due 30 days after it reached the tenant.
	await page.goto(`/betriebskosten/abrechnungen/${statementId}`);
	await approve(page);
	await expect(lease).toContainText('fällig 30 Tage nach Zustellung');
	await expect(page.getByText('Freigegeben', { exact: true })).toBeVisible();
	await expect(page.getByText(`freigegeben am ${german(today)}`)).toBeVisible();
	await expect(lease.getByRole('link', { name: 'PDF' })).toHaveAttribute(
		'href',
		`/betriebskosten/abrechnungen/${statementId}/pdf/${leaseId}`
	);
	// No heating cost in this statement: only the operating cost prepayment, 3.000 / 12.
	await expect(lease.getByRole('link', { name: 'Vorauszahlung anpassen' })).toHaveAttribute(
		'href',
		`/vertraege/${leaseId}/miethoehe?prepayment=25000`
	);

	// The PDF from the frozen result.
	const text = await pdfOf(page, `/betriebskosten/abrechnungen/${statementId}/pdf/${leaseId}`);
	expect(text).toContain(`Betriebskostenabrechnung ${year}`);
	expect(text).toContain('Gesamtkosten');
	expect(text).toContain(`Wohnfläche ${suffix}: 72,5 m²`);
	expect(text).toContain('Dein Anteil');
	expect(text).toContain('72,5 m² von 72,5 m²');
	expect(text).toContain('3.000,00 €');
	expect(text).toContain('Geleistete Vorauszahlungen');
	expect(text).toContain('Summe 2.400,00 € 2.200,00 €');
	expect(text).toContain('hast du 200,00 € nicht geleistet');
	expect(text).toContain('geleistete Vorauszahlungen 2.200,00 €: Nachzahlung 800,00 €');
	expect(text).toContain('innerhalb von 30 Tagen nach Zugang dieser Abrechnung');
	// The PDF route answers 404 for a lease that is not part of the statement.
	const foreign = await page.request.get(
		`/betriebskosten/abrechnungen/${statementId}/pdf/does-not-exist`
	);
	expect(foreign.status()).toBe(404);

	// The delivery date cannot precede the approval; it starts the Einwendungsfrist, which runs to
	// the end of the twelfth month after it.
	const [deliveredYear, deliveredMonth] = today.split('-').map(Number);
	const objectionEnd = new Date(Date.UTC(deliveredYear + 1, deliveredMonth, 0))
		.toISOString()
		.slice(0, 10);
	const delivered = lease.getByLabel(`zugestellt am Wohnung EG ${suffix}`);
	await delivered.fill(addDays(today, -1));
	await lease.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('kann nicht vorher zugestellt worden sein')).toBeVisible();
	await delivered.fill(today);
	await lease.getByRole('button', { name: 'Speichern' }).click();
	await expect(lease).toContainText(`Einwendungsfrist bis ${german(objectionEnd)}`);
	const due = addDays(today, 30);
	await expect(lease).toContainText(`fällig am ${german(due)}`);

	// A forgotten credit note of 500 €, then the correction: a new draft version.
	await seedRows(page.request, 'costItems', [costItem('Grundsteuer Erstattung', -50000)]);
	await page.getByRole('button', { name: 'Korrektur erstellen' }).click();
	// The action redirects to the new draft; wait until the old id has left the URL.
	await expect(page).not.toHaveURL(`/betriebskosten/abrechnungen/${statementId}`);
	await expect(page).toHaveURL(/\/betriebskosten\/abrechnungen\/[0-9a-f-]{36}$/);
	const correctionId = page.url().split('/').pop()!;
	await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
	await expect(page.getByText('Version 2')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Version 1' })).toHaveAttribute(
		'href',
		`/betriebskosten/abrechnungen/${statementId}`
	);
	await expect(lease).toContainText('Nachzahlung 300,00 €');

	// Approving the correction reverses the 600 € and posts 300 − 200 = 100 € in one batch.
	await approve(page);
	await expect(page.getByText('Freigegeben', { exact: true })).toBeVisible();
	await page.goto(
		`/vertraege/${leaseId}/mietkonto?from=${today.slice(0, 7)}&to=${due.slice(0, 7)}`
	);
	const postings = page
		.getByRole('table', { name: 'Buchungen' })
		.getByRole('row')
		.filter({ hasText: `Betriebskostenabrechnung ${year}` });
	// The posting and its reversal are due 30 days after the delivery, the new posting is dated
	// today until its delivery; rows of one batch share their timestamp, so the order is not fixed.
	await expect(postings).toHaveCount(3);
	// The Soll cell alone, so a running balance such as 17.600,00 € cannot match.
	const soll = (amount: string) => ({
		has: page.getByRole('cell', { name: new RegExp(`^${amount}\\s€$`) })
	});
	const reversal = postings.filter({ hasText: 'Storno durch Korrektur' });
	await expect(reversal.filter(soll('-600,00'))).toHaveCount(1);
	const own = postings.filter({ hasNotText: 'Storno' });
	await expect(own).toHaveCount(2);
	await expect(own.filter(soll('600,00'))).toHaveCount(1);
	await expect(own.filter(soll('100,00'))).toHaveCount(1);

	// The list shows both versions; the first one is superseded.
	await page.goto('/betriebskosten');
	const list = page.getByRole('table', { name: /^Abrechnungen Testhaus/ }).filter({
		hasText: '3.500,00 €'
	});
	await expect(list.getByRole('row')).toHaveCount(3);
	await page.goto(`/betriebskosten/abrechnungen/${statementId}`);
	await expect(page.getByText('Ersetzt', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Version 2' })).toHaveAttribute(
		'href',
		`/betriebskosten/abrechnungen/${correctionId}`
	);
});

/** A lease seeded as raw rows on an existing unit, with its rent history, persons and tenant. */
async function seedRawLease(
	request: APIRequestContext,
	lease: {
		unitId: string;
		tenantId: string;
		startDate: string;
		endDate: string | null;
		persons: number;
		operating: number;
		heating: number;
		/** The rent paid in full up to December 2025: the months of the lease until then. */
		paidMonths: number;
	}
): Promise<string> {
	const amounts = {
		baseRent: 60000,
		operatingCostPrepayment: lease.operating,
		heatingCostPrepayment: lease.heating
	};
	const {
		ids: [leaseId]
	} = await seedRows(request, 'leases', [
		{
			unitId: lease.unitId,
			startDate: lease.startDate,
			endDate: lease.endDate,
			persons: lease.persons,
			...amounts
		}
	]);
	await seedRows(request, 'leaseTenants', [{ leaseId, tenantId: lease.tenantId }]);
	await seedRows(request, 'leasePersons', [
		{ leaseId, validFrom: lease.startDate, persons: lease.persons }
	]);
	await seedRows(request, 'rentChanges', [
		{ leaseId, validFrom: lease.startDate, reason: 'initial', status: 'approved', ...amounts }
	]);
	await seedRows(request, 'payments', [
		{
			leaseId,
			date: '2025-12-31',
			amount: lease.paidMonths * (amounts.baseRent + lease.operating + lease.heating)
		}
	]);
	return leaseId;
}

// The reference scenario hand-computed in src/lib/domain/statement.spec.ts: Lindenstraße 4 with
// EG (72,5 m², 2 persons, all year), OG (64 m², tenant change on 30 June with a heat meter
// reading) and DG (48 m², vacant from 1 September), Grundsteuer 1.200 € by area, Müll 600 € by
// persons, Hausmeister 900 € by units, Heizung 3.000 € 70/30, Verwaltung 500 € not allocable;
// every rent paid. EG's statement: costs 2.346,66 € against 2.400 € prepayments, a Guthaben of
// 53,34 €. The figures do not depend on today: a Guthaben is posted whether or not the 2025
// deadline has passed.
test('prints the reference scenario with the four elements of a valid statement', async ({
	page
}) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	const request = page.request;
	const {
		propertyId,
		unitId: eg,
		leaseId: egLease
	} = await seedLease(request, {
		property: { name: `Lindenstraße 4 ${suffix}`, vacancyPersons: 1 },
		unit: { name: `EG ${suffix}`, floorArea: 72.5 },
		tenant: { salutation: 'Herr', firstName: 'Max', lastName: `Müller ${suffix}` },
		lease: { startDate: '2024-06-01', ledgerStart: '2025-02-01', persons: 2 }
	});
	// The rent account starts in February; January's prepayments count as paid.
	await seedRows(request, 'payments', [
		{ leaseId: egLease, date: '2025-12-31', amount: 11 * 80000 }
	]);
	const {
		ids: [og, dg]
	} = await seedRows(request, 'units', [
		{ propertyId, name: `OG ${suffix}`, kind: 'apartment', floorArea: 64 },
		{ propertyId, name: `DG ${suffix}`, kind: 'apartment', floorArea: 48 }
	]);
	const {
		ids: [alt, neu, dach]
	} = await seedRows(request, 'tenants', [
		{ salutation: 'Frau', firstName: 'Anna', lastName: `Alt ${suffix}` },
		{ salutation: 'Herr', firstName: 'Bernd', lastName: `Neu ${suffix}` },
		{ salutation: 'Frau', firstName: 'Dora', lastName: `Dach ${suffix}` }
	]);
	await seedRawLease(request, {
		unitId: og,
		tenantId: alt,
		startDate: '2023-01-01',
		endDate: '2025-06-30',
		persons: 2,
		operating: 12000,
		heating: 6000,
		paidMonths: 30
	});
	await seedRawLease(request, {
		unitId: og,
		tenantId: neu,
		startDate: '2025-07-01',
		endDate: null,
		persons: 1,
		operating: 10000,
		heating: 5000,
		paidMonths: 6
	});
	await seedRawLease(request, {
		unitId: dg,
		tenantId: dach,
		startDate: '2022-01-01',
		endDate: '2025-08-31',
		persons: 1,
		operating: 8000,
		heating: 4000,
		paidMonths: 44
	});

	const {
		ids: [grundsteuer, muell, hauswart, heizung, verwaltung]
	} = await seedRows(request, 'costCategories', [
		{ name: `Grundsteuer ${suffix}`, betrkvItem: 1 },
		{ name: `Müllbeseitigung ${suffix}`, betrkvItem: 8 },
		{ name: `Hauswart ${suffix}`, betrkvItem: 14 },
		{ name: `Heizung ${suffix}`, betrkvItem: 4, consumptionBased: true },
		{ name: `Verwaltung ${suffix}`, allocable: false }
	]);
	const {
		ids: [area, persons, unitsKey, heat]
	} = await seedRows(request, 'allocationKeys', [
		{ name: `Wohnfläche ${suffix}`, kind: 'area' },
		{ name: `Personen ${suffix}`, kind: 'persons' },
		{ name: `Einheiten ${suffix}`, kind: 'units' },
		{ name: `Heizung 70/30 ${suffix}`, kind: 'mixed', meterKind: 'heat', consumptionPercent: 70 }
	]);
	const item = (
		description: string,
		categoryId: string,
		allocationKeyId: string,
		amount: number
	) => ({
		propertyId,
		categoryId,
		allocationKeyId,
		description,
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		amount
	});
	await seedRows(request, 'costItems', [
		item('Grundsteuer 2025', grundsteuer, area, 120000),
		item('Müllabfuhr', muell, persons, 60000),
		item('Hausmeister', hauswart, unitsKey, 90000),
		item('Gasrechnung', heizung, heat, 300000),
		item('Hausverwaltung', verwaltung, unitsKey, 50000)
	]);
	const {
		ids: [egMeter, ogMeter, dgMeter]
	} = await seedRows(request, 'meters', [
		{ propertyId, unitId: eg, kind: 'heat', unit: 'kWh' },
		{ propertyId, unitId: og, kind: 'heat', unit: 'kWh' },
		{ propertyId, unitId: dg, kind: 'heat', unit: 'kWh' }
	]);
	await seedRows(request, 'meterReadings', [
		{ meterId: egMeter, readAt: '2025-01-01', value: 0 },
		{ meterId: egMeter, readAt: '2025-12-31', value: 1000 },
		{ meterId: ogMeter, readAt: '2025-01-01', value: 0 },
		{ meterId: ogMeter, readAt: '2025-06-30', value: 600 },
		{ meterId: ogMeter, readAt: '2025-12-31', value: 1000 },
		{ meterId: dgMeter, readAt: '2025-01-01', value: 0 },
		{ meterId: dgMeter, readAt: '2025-12-31', value: 200 }
	]);

	const statementId = await createDraft(page, propertyId, '2025-01-01', '2025-12-31');
	const lease = page.getByRole('region', { name: `Mietvertrag EG ${suffix}` });
	await expect(lease).toContainText('Guthaben 53,34 € (Kosten 2.346,66 €');
	// The vacant DG from September: the landlord's share.
	await expect(page.locator('.stats')).toContainText('401,94 €');
	await approve(page);

	// § 560 Abs. 4 BGB: operating 1.038,45 / 12 = 86,54 € and heating 1.308,21 / 12 = 109,02 €.
	await expect(lease.getByRole('link', { name: 'Vorauszahlung anpassen' })).toHaveAttribute(
		'href',
		`/vertraege/${egLease}/miethoehe?prepayment=8654&heating=10902`
	);
	// The DG lease has ended: nothing to adjust there.
	await expect(
		page
			.getByRole('region', { name: `Mietvertrag DG ${suffix}` })
			.getByRole('link', { name: 'Vorauszahlung anpassen' })
	).toHaveCount(0);

	const text = await pdfOf(page, `/betriebskosten/abrechnungen/${statementId}/pdf/${egLease}`);
	expect(text).toContain(`Lindenstraße 4 ${suffix}`);
	expect(text).toContain('Herr Max Müller');
	// Gesamtkosten.
	expect(text).toContain('1.200,00 €');
	expect(text).toContain('3.000,00 €');
	// Umlageschlüssel with the key total and the lease's share of it.
	expect(text).toContain(`Wohnfläche ${suffix}: 184,5 m²`);
	expect(text).toContain('72,5 m² von 184,5 m² · 365 von 365 Tagen');
	expect(text).toContain(`Personen ${suffix}: 1.641 Personentage`);
	expect(text).toContain('730 von 1.641 Personentagen');
	expect(text).toContain('1 von 3 Einheiten');
	expect(text).toContain('70 % nach Verbrauch: 1.000 von 2.200 kWh');
	// Dein Anteil per line and in sum.
	expect(text).toContain('471,54 €');
	expect(text).toContain('266,91 €');
	expect(text).toContain('1.308,21 €');
	expect(text).toContain('Summe 2.346,66 €');
	// The paid prepayments (January from the rent history) and the result.
	expect(text).toContain('Summe 2.400,00 € 2.400,00 €');
	expect(text).toContain(
		'Kosten gesamt 2.346,66 €, geleistete Vorauszahlungen 2.400,00 €: Guthaben 53,34 €.'
	);
	expect(text).toContain('Das Guthaben von 53,34 €');

	// The prepayment link fills both fields of the Miethöhe form.
	await lease.getByRole('link', { name: 'Vorauszahlung anpassen' }).click();
	await expect(page.getByLabel('Betriebskostenvorauszahlung')).toHaveValue('86,54');
	await expect(page.getByLabel('Heizkostenvorauszahlung')).toHaveValue('109,02');
});

test('answers unknown statements with 404 and refuses a property of another account', async ({
	page
}) => {
	const response = await page.goto('/betriebskosten/abrechnungen/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
	// The actions too, before they read the form.
	const action = await page.request.post('/betriebskosten/abrechnungen/does-not-exist?/delete', {
		form: { confirm: '1' },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(action.status()).toBe(404);

	// A draft for a property of another account is refused like an unknown one.
	const foreign = await seedForeignLease(page.request);
	const created = await page.request.post('/betriebskosten?/create', {
		form: { propertyId: foreign.propertyId, periodStart: '2025-01-01', periodEnd: '2025-12-31' },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(created.status()).toBe(400);
	expect(await created.text()).toContain('Dieses Objekt gibt es nicht.');
});
