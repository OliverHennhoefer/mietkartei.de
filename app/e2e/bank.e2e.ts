import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { seedLease } from './seed';

// The banking feature end to end: a bank account, a Sparkasse export imported twice, the inline
// assignment with a remembered rule, undo, ignore, a generic file with a column mapping, and 404
// for an unknown transaction. The lease is seeded; only the /bank pages are driven. The tests
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

async function uploadSparkasse(page: Page) {
	await page.goto('/bank/import');
	await page.getByLabel('Bankverbindung').selectOption({ label: accountName });
	await page.locator('input[name="file"]').setInputFiles({
		name: 'umsatz.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(sparkasseCsv, 'latin1')
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

	await page.goto('/bank/konten');
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
	await page.goto('/bank');
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

test('imports a file without a known header through a column mapping', async ({ page }) => {
	await page.goto('/bank/import');
	await page.getByLabel('Bankverbindung').selectOption({ label: accountName });
	await page
		.locator('input[name="file"]')
		.setInputFiles(path.join(import.meta.dirname, 'fixtures', 'bank-generic.csv'));
	await page.getByRole('button', { name: 'Datei prüfen' }).click();
	await expect(
		page.getByText('Format nicht erkannt; ordne die Spalten der Datei zu.')
	).toBeVisible();
	await expect(page.getByText('Bitte wähle die Spalte mit dem Buchungstag.')).toBeVisible();

	// The accessible name of a select is its label alone; the label's text would include the options.
	const mapping = (name: string) => page.getByRole('combobox', { name, exact: true });
	await mapping('Buchungstag').selectOption('Datum');
	await mapping('Betrag').selectOption('Betrag');
	await mapping('Name der Gegenseite (optional)').selectOption('Name');
	await mapping('Verwendungszweck (optional)').selectOption('Text');
	await page.getByRole('button', { name: 'Vorschau aktualisieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'3 Zeilen: 2 neu, 0 Duplikate, 0 per Regel zugeordnet, 1 ungültig.'
	);
	await expect(page.getByRole('table', { name: 'Vorschau' })).toContainText(
		'Ungültiges Datum „irgendwann“'
	);
	await page.getByRole('button', { name: 'Importieren' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Import abgeschlossen: 2 neue Umsätze, 0 Duplikate, 0 per Regel zugeordnet, 1 ungültige Zeilen übersprungen.'
	);
	await page.goto('/bank');
	await expect(card(page, 'Gartenpflege Beispiel')).toContainText('-95,00 €');
});

test('answers an unknown transaction with 404', async ({ page, baseURL }) => {
	await page.goto('/bank');
	const response = await page.request.post('/bank?/ignore', {
		form: { id: 'does-not-exist' },
		headers: { origin: baseURL ?? '' }
	});
	expect(response.status()).toBe(404);
});
