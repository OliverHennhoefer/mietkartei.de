import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { seedLease } from './seed';

// The banking feature end to end: a bank account, a Sparkasse export imported twice, the inline
// assignment with a remembered rule, undo, ignore, a generic file with a column mapping, a third
// file whose line the remembered rule assigns on import, a split over two leases, a deposit, a
// double submit that books once, 404 for an unknown transaction and a camt.053 statement. The lease is seeded; only the /bank pages are driven. The tests
// build on each other, so they run in order.

test.describe.configure({ mode: 'serial' });

const suffix = crypto.randomUUID().slice(0, 6);
const lastName = `Zahler-${suffix}`;
const purpose = `Miete Oktober für ${lastName}`;
const unitName = `Wohnung ${suffix}`;
const accountName = `Mietkonto ${suffix}`;
const tenantIban = 'DE12500105175407324931';

// Two identical incoming lines on one day (occurrence 0 and 1) and one outgoing line, written as
// the Sparkasse writes them: semicolons, two-digit years, windows-1252.
const sparkasseCsv = [
	'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
	`DE02120300000000202051;01.10.26;01.10.26;GUTSCHR. UEBERWEISUNG;${purpose};;;;;;;Max ${lastName};${tenantIban};INGDDEFFXXX;850,00;EUR;Umsatz gebucht`,
	`DE02120300000000202051;01.10.26;01.10.26;GUTSCHR. UEBERWEISUNG;${purpose};;;;;;;Max ${lastName};${tenantIban};INGDDEFFXXX;850,00;EUR;Umsatz gebucht`,
	`DE02120300000000202051;02.10.26;02.10.26;ONLINE-UEBERWEISUNG;Hausmeister ${suffix};;;;;;;Hausmeister GmbH;DE89370400440532013000;COBADEFFXXX;-120,50;EUR;Umsatz gebucht`
].join('\r\n');

let leaseId: string;

// A later export: the tenant's November rent (the remembered rule on the IBAN assigns it on
// import), a transfer for flat and parking space from another account (split over two leases) and
// a deposit from a third account.
const laterCsv = [
	sparkasseCsv.split('\r\n')[0],
	`DE02120300000000202051;05.10.26;05.10.26;GUTSCHR. UEBERWEISUNG;Miete November für ${lastName};;;;;;;Max ${lastName};${tenantIban};INGDDEFFXXX;850,00;EUR;Umsatz gebucht`,
	`DE02120300000000202051;06.10.26;06.10.26;GUTSCHR. UEBERWEISUNG;Wohnung und Stellplatz ${suffix};;;;;;;Familie Teiler;DE89370400440532013000;COBADEFFXXX;900,00;EUR;Umsatz gebucht`,
	`DE02120300000000202051;07.10.26;07.10.26;GUTSCHR. UEBERWEISUNG;Kaution ${suffix};;;;;;;Eltern Zahler;DE75512108001245126199;HELADEF1822;1800,00;EUR;Umsatz gebucht`
].join('\r\n');

async function uploadSparkasse(page: Page, csv = sparkasseCsv) {
	await page.goto('/bank/import');
	await page.getByLabel('Bankverbindung').selectOption({ label: accountName });
	await page.locator('input[name="file"]').setInputFiles({
		name: 'umsatz.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv, 'latin1')
	});
	await page.getByRole('button', { name: 'Datei prüfen' }).click();
	await expect(page.getByText('Format Sparkasse (CSV-CAMT) erkannt.')).toBeVisible();
}

function card(page: Page, text: string): Locator {
	return page
		.getByRole('list', { name: 'Umsätze' })
		.getByRole('listitem')
		.filter({ hasText: text });
}

test('creates a bank account', async ({ page }) => {
	const seeded = await seedLease(page.request, {
		property: { name: `Testhaus ${suffix}` },
		unit: { name: unitName },
		tenant: { firstName: 'Max', lastName }
	});
	leaseId = seeded.leaseId;

	// Reached through the Konten tab of the bank.
	await page.goto('/bank');
	await page.getByRole('link', { name: 'Konten', exact: true }).click();
	await expect(page).toHaveURL(/\/bank\/konten$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bank');
	await page.getByLabel('Bezeichnung').fill(accountName);
	await page.getByLabel('IBAN').fill('de02 1203 0000 0000 2020 51');
	await page.getByLabel('BIC (optional)').fill('byladem1001');
	await page.getByLabel('Kontoinhaber').fill('Vera Vermieterin');
	await page.getByRole('button', { name: 'Bankverbindung anlegen' }).click();

	await expect(page.getByText(`„${accountName}“ wurde angelegt.`)).toBeVisible();
	const row = page.getByRole('row', { name: new RegExp(accountName) });
	await expect(row).toContainText('DE02 1203 0000 0000 2020 51');
	await expect(row).toContainText('BYLADEM1001');
	await expect(row).toContainText('Vera Vermieterin');

	// The same IBAN a second time is refused: one statement must not be imported twice.
	await page.getByLabel('Bezeichnung').fill('Zweitkonto');
	await page.getByLabel('IBAN').fill('DE02120300000000202051');
	await page.getByLabel('Kontoinhaber').fill('Vera Vermieterin');
	await page.getByRole('button', { name: 'Bankverbindung anlegen' }).click();
	await expect(page.getByText('Ein Konto mit dieser IBAN gibt es schon.')).toBeVisible();
	await expect(page.getByRole('row', { name: /Zweitkonto/ })).toHaveCount(0);
});

test('imports a Sparkasse export and recognises it as duplicates the second time', async ({
	page
}) => {
	await uploadSparkasse(page);
	await expect(page.getByRole('status')).toContainText(
		'3 Zeilen: 3 neu, 0 Duplikate, 0 per Regel zugeordnet, 0 ungültig.'
	);
	const preview = page.getByRole('table', { name: 'Vorschau' });
	await expect(preview.getByRole('row')).toHaveCount(4);
	await expect(preview).toContainText(`Max ${lastName}`);
	await expect(preview).toContainText(purpose);
	await expect(preview).toContainText('+850,00 €');
	await expect(preview).toContainText('-120,50 €');
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Import abgeschlossen: 3 neue Umsätze, 0 Duplikate, 0 per Regel zugeordnet.'
	);

	await uploadSparkasse(page);
	await expect(page.getByRole('status')).toContainText(
		'3 Zeilen: 0 neu, 3 Duplikate, 0 per Regel zugeordnet, 0 ungültig.'
	);
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Import abgeschlossen: 0 neue Umsätze, 3 Duplikate, 0 per Regel zugeordnet.'
	);

	await page.goto('/bank/konten');
	await expect(
		page
			.getByRole('row', { name: new RegExp(accountName) })
			.getByRole('cell')
			.nth(4)
	).toHaveText('3');
});

test('suggests the lease by the tenant name, assigns and remembers a rule', async ({ page }) => {
	// The Umsätze tab is the Bank entry of the main navigation.
	await page.goto('/objekte');
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('link', { name: 'Bank', exact: true })
		.click();
	await expect(page).toHaveURL(/\/bank$/);
	const open = card(page, purpose);
	await expect(open).toHaveCount(2);
	const first = open.first();
	await expect(first).toContainText('Vorschlag: Name des Mieters im Text');
	await expect(first.locator('select[name="leaseId"]')).toHaveValue(leaseId);
	await first.getByLabel('Zuordnung merken').check();
	await first.getByRole('button', { name: 'Zuordnen' }).click();
	await expect(card(page, purpose)).toHaveCount(1);

	await page.goto('/bank?status=matched');
	const matched = card(page, purpose);
	await expect(matched).toHaveCount(1);
	await expect(matched).toContainText('Zahlung');
	await expect(matched).toContainText('+850,00 €');
	await expect(matched).toContainText(`${unitName} · Testhaus ${suffix} – ${lastName}`);

	await page.goto('/bank/regeln');
	const rule = page.getByRole('row', { name: new RegExp(lastName) });
	await expect(rule).toContainText('IBAN der Gegenseite');
	await expect(rule).toContainText(tenantIban);
	await expect(rule).toContainText('bestätigt');

	// The remembered rule now assigns on import: the second line is already in, so the suggestion
	// for it comes from the rule.
	await page.goto('/bank');
	await expect(card(page, purpose)).toContainText('Vorschlag: nach Regel');

	// A bank account with an assigned transaction cannot be deleted.
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/bank/konten');
	await page
		.getByRole('row', { name: new RegExp(accountName) })
		.getByRole('button', { name: 'Löschen' })
		.click();
	await expect(page.getByRole('alert')).toContainText('hat zugeordnete Umsätze');
	await expect(page.getByRole('row', { name: new RegExp(accountName) })).toBeVisible();
});

test('undoes the assignment', async ({ page }) => {
	page.on('dialog', (dialog) => dialog.accept());
	await page.goto('/bank?status=matched');
	await card(page, purpose).getByRole('button', { name: 'Zuordnung aufheben' }).click();
	await expect(card(page, purpose)).toHaveCount(0);
	await page.goto('/bank');
	await expect(card(page, purpose)).toHaveCount(2);
});

test('ignores a transaction and reopens it', async ({ page }) => {
	await page.goto('/bank');
	const outgoing = card(page, `Hausmeister ${suffix}`);
	await expect(outgoing).toContainText('-120,50 €');
	await outgoing.getByRole('button', { name: 'Ignorieren' }).click();
	await expect(card(page, `Hausmeister ${suffix}`)).toHaveCount(0);

	await page.goto('/bank?status=ignored');
	const ignored = card(page, `Hausmeister ${suffix}`);
	await expect(ignored).toContainText('Ignoriert');
	await ignored.getByRole('button', { name: 'Wieder öffnen' }).click();
	await expect(card(page, `Hausmeister ${suffix}`)).toHaveCount(0);
	await page.goto('/bank');
	await expect(card(page, `Hausmeister ${suffix}`)).toHaveCount(1);
});

test('books an outgoing line as an expense and undoes it', async ({ page }) => {
	await page.goto('/bank');
	const outgoing = card(page, `Hausmeister ${suffix}`);
	// Money paid out without a lease suggestion opens the expense form right away.
	await outgoing.getByLabel('Kategorie').selectOption({ label: 'Hausgeld (WEG)' });
	await expect(outgoing.getByLabel('Beschreibung')).toHaveValue('Hausmeister GmbH');
	await outgoing.getByRole('button', { name: 'Als Ausgabe buchen' }).click();
	await expect(card(page, `Hausmeister ${suffix}`)).toHaveCount(0);

	await page.goto('/bank?status=matched');
	const booked = card(page, `Hausmeister ${suffix}`);
	await expect(booked).toContainText('Ausgabe 120,50 € (Hausgeld (WEG))');
	page.on('dialog', (dialog) => dialog.accept());
	await booked.getByRole('button', { name: 'Zuordnung aufheben' }).click();
	await expect(card(page, `Hausmeister ${suffix}`)).toHaveCount(0);
	await page.goto('/bank');
	await expect(card(page, `Hausmeister ${suffix}`)).toHaveCount(1);
});

test('imports a file without a known header through a column mapping', async ({ page }) => {
	await page.goto('/bank/import');
	await page.getByLabel('Bankverbindung').selectOption({ label: accountName });
	await page
		.locator('input[name="file"]')
		.setInputFiles(path.join(import.meta.dirname, 'fixtures', 'bank-generic.csv'));
	await page.getByRole('button', { name: 'Datei prüfen' }).click();
	// The column names are known, so the mapping is proposed and the preview follows right away.
	await expect(
		page.getByText('Format nicht erkannt; die Spalten sind nach ihren Namen zugeordnet.')
	).toBeVisible();

	// The accessible name of a select is its label alone; the label's text would include the options.
	const mapping = (name: string) => page.getByRole('combobox', { name, exact: true });
	await expect(mapping('Buchungstag')).toHaveValue('Datum');
	await expect(mapping('Betrag')).toHaveValue('Betrag');
	await expect(mapping('Name der Gegenseite (optional)')).toHaveValue('Name');
	await expect(mapping('Verwendungszweck (optional)')).toHaveValue('Text');
	await expect(page.getByRole('status')).toContainText(
		'3 Zeilen: 2 neu, 0 Duplikate, 0 per Regel zugeordnet, 1 ungültig.'
	);
	await expect(page.getByRole('table', { name: 'Vorschau' })).toContainText(
		'Ungültiges Datum „irgendwann“'
	);
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Import abgeschlossen: 2 neue Umsätze, 0 Duplikate, 0 per Regel zugeordnet, 1 ungültige Zeile übersprungen.'
	);
	await page.goto('/bank');
	await expect(card(page, 'Gartenpflege Beispiel')).toContainText('-95,00 €');
});

test('assigns a line by the remembered rule on import', async ({ page }) => {
	await uploadSparkasse(page, laterCsv);
	await expect(page.getByRole('status')).toContainText(
		'3 Zeilen: 2 neu, 0 Duplikate, 1 per Regel zugeordnet, 0 ungültig.'
	);
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Import abgeschlossen: 3 neue Umsätze, 0 Duplikate, 1 per Regel zugeordnet.'
	);

	await page.goto('/bank?status=matched');
	const assigned = card(page, `Miete November für ${lastName}`);
	await expect(assigned).toHaveCount(1);
	await expect(assigned.getByRole('listitem')).toHaveText(
		`Zahlung +850,00 € → ${unitName} · Testhaus ${suffix} – ${lastName}`
	);
	await page.goto('/bank');
	await expect(card(page, `Miete November für ${lastName}`)).toHaveCount(0);
});

test('splits a line over two leases and books a deposit', async ({ page }) => {
	const parking = await seedLease(page.request, {
		property: { name: `Stellplatzhaus ${suffix}` },
		unit: { name: `Stellplatz ${suffix}` },
		tenant: { firstName: 'Max', lastName: `Teiler-${suffix}` }
	});

	await page.goto('/bank');
	const split = card(page, `Wohnung und Stellplatz ${suffix}`);
	await split.locator('select[name="leaseId"]').selectOption(leaseId);
	await split.getByText('Auf zwei Mietverträge aufteilen').click();
	await split.getByLabel('Zweiter Mietvertrag').selectOption(parking.leaseId);
	await split.getByLabel('Betrag erster Vertrag').fill('800,00');
	await split.getByLabel('Betrag zweiter Vertrag').fill('50,00');
	await split.getByRole('button', { name: 'Zuordnen' }).click();
	await expect(split.locator('.error')).toHaveText(
		'Die beiden Beträge müssen zusammen 900,00 € ergeben.'
	);
	await split.getByLabel('Betrag zweiter Vertrag').fill('100,00');
	await split.getByRole('button', { name: 'Zuordnen' }).click();
	await expect(card(page, `Wohnung und Stellplatz ${suffix}`)).toHaveCount(0);

	const deposit = card(page, `Kaution ${suffix}`);
	await deposit.locator('select[name="leaseId"]').selectOption(leaseId);
	await deposit.getByLabel('Buchen als').selectOption('deposit');
	await deposit.getByRole('button', { name: 'Zuordnen' }).click();
	await expect(card(page, `Kaution ${suffix}`)).toHaveCount(0);

	await page.goto('/bank?status=matched');
	const lines = card(page, `Wohnung und Stellplatz ${suffix}`).getByRole('listitem');
	await expect(lines).toHaveCount(2);
	await expect(lines.filter({ hasText: unitName })).toContainText('Zahlung +800,00 €');
	await expect(lines.filter({ hasText: `Stellplatz ${suffix} ·` })).toContainText(
		'Zahlung +100,00 €'
	);
	await expect(card(page, `Kaution ${suffix}`).getByRole('listitem')).toHaveText(
		`Kaution +1.800,00 € → ${unitName} · Testhaus ${suffix} – ${lastName}`
	);
});

test('books a double submit of one assignment once', async ({ page, baseURL }) => {
	await page.goto('/bank');
	const open = card(page, purpose).first();
	const id = await open.locator('input[name="id"]').first().getAttribute('value');
	if (!id) throw new Error('no transaction id');
	const submit = () =>
		page.request.post('/bank?/assign', {
			form: { id, leaseId, target: 'rent' },
			headers: { origin: baseURL ?? '' }
		});
	const statuses = (await Promise.all([submit(), submit()])).map((response) => response.status());
	expect(statuses.sort()).toEqual([200, 400]);

	await page.goto('/bank?status=matched');
	const matched = card(page, purpose);
	await expect(matched).toHaveCount(1);
	await expect(matched.getByRole('listitem')).toHaveCount(1);
	await expect(matched.getByRole('listitem')).toContainText('Zahlung +850,00 €');
});

test('answers an unknown transaction with 404', async ({ page, baseURL }) => {
	await page.goto('/bank');
	const response = await page.request.post('/bank?/ignore', {
		form: { id: 'does-not-exist' },
		headers: { origin: baseURL ?? '' }
	});
	expect(response.status()).toBe(404);
});

test('imports a camt.053 statement, leaving out the lines of another account', async ({ page }) => {
	const entry = (amount: string, indicator: string, party: string, text: string) => `
		<Ntry>
			<Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${indicator}</CdtDbtInd><Sts>BOOK</Sts>
			<BookgDt><Dt>2026-12-01</Dt></BookgDt>
			<NtryDtls><TxDtls><RltdPties>${party}</RltdPties>
				<RmtInf><Ustrd>${text}</Ustrd></RmtInf></TxDtls></NtryDtls>
		</Ntry>`;
	const statement = (iban: string, entries: string) =>
		`<Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct>${entries}</Stmt>`;
	const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
	${statement(
		'DE02120300000000202051',
		entry(
			'850.00',
			'CRDT',
			`<Dbtr><Nm>Max ${lastName}</Nm></Dbtr><DbtrAcct><Id><IBAN>${tenantIban}</IBAN></Id></DbtrAcct>`,
			`Miete Dezember camt ${suffix}`
		) + entry('49.90', 'DBIT', '<Cdtr><Nm>Stadtwerke</Nm></Cdtr>', `Strom camt ${suffix}`)
	)}
	${statement('DE75512108001245126199', entry('10.00', 'CRDT', '', `Fremdkonto ${suffix}`))}
</BkToCstmrStmt></Document>`;

	await page.goto('/bank/import');
	await page.getByLabel('Bankverbindung').selectOption({ label: accountName });
	await page.locator('input[name="file"]').setInputFiles({
		name: 'auszug.xml',
		mimeType: 'application/xml',
		buffer: Buffer.from(camt, 'utf8')
	});
	await page.getByRole('button', { name: 'Datei prüfen' }).click();
	await expect(page.getByText('Format camt.053 (XML-Kontoauszug) erkannt.')).toBeVisible();
	await expect(page.getByRole('status')).toContainText(
		'3 Zeilen: 1 neu, 0 Duplikate, 1 per Regel zugeordnet, 1 ungültig.'
	);
	await expect(page.getByRole('table', { name: 'Vorschau' })).toContainText(
		'Auszug eines anderen Kontos (DE75 5121 0800 1245 1261 99)'
	);
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Import abgeschlossen: 2 neue Umsätze, 0 Duplikate, 1 per Regel zugeordnet, 1 ungültige Zeile übersprungen.'
	);
	await page.goto('/bank');
	await expect(card(page, `Strom camt ${suffix}`)).toContainText('-49,90 €');
});
