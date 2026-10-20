import { describe, expect, it } from 'vitest';
import { parseCsv, toRecords } from '../csv';
import {
	applyRules,
	base64ToBytes,
	bytesToBase64,
	detectPreset,
	fingerprintInput,
	fingerprintRows,
	formatIban,
	genericHeaderRow,
	mapRecord,
	mapRecords,
	normalizeIban,
	rememberedRule,
	ruleMatches,
	splitComdirectText,
	suggestLease,
	type BankRow,
	type Rule
} from './bank-matching';

// One fixture per bank, as the bank writes it (semicolons, German dates and amounts, preambles).

const sparkasseCamt = [
	'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
	'DE02120300000000202051;01.10.26;01.10.26;GUTSCHR. UEBERWEISUNG;Miete Oktober;;;;;;;Max Müller;DE12500105175407324931;INGDDEFFXXX;850,00;EUR;Umsatz gebucht',
	'DE02120300000000202051;02.10.26;02.10.26;ONLINE-UEBERWEISUNG;Hausmeister September;;;;;;;Hausmeister GmbH;DE89370400440532013000;COBADEFFXXX;-120,50;EUR;Umsatz gebucht'
].join('\n');

const sparkasseMt940 = [
	'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Beguenstigter/Zahlungspflichtiger;Kontonummer;BLZ;Betrag;Waehrung;Info',
	'12345678;03.10.26;03.10.26;GUTSCHRIFT;Miete Oktober Schmidt;Erika Schmidt;DE12500105175407324931;50010517;640,00;EUR;Umsatz gebucht'
].join('\n');

const volksbank = [
	'Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valuta;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Kategorie;Steuerrelevant;Glaeubiger ID;Mandatsreferenz',
	'Girokonto;DE02120300000000202051;BYLADEM1001;Volksbank;04.10.2026;04.10.2026;Erika Schmidt;DE12 5001 0517 5407 3249 31;INGDDEFFXXX;Überweisungsgutschr.;Miete 10/2026 Wohnung 2;640,00;EUR;3.000,00;;;;;'
].join('\n');

const ing = [
	'Umsatzanzeige;Datei erstellt am: 20.10.2026 10:00',
	'IBAN;DE12 5001 0517 5407 3249 31',
	'',
	'Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
	'05.10.2026;05.10.2026;Max Müller;Gutschrift;Miete Oktober;1.234,56;EUR;850,00;EUR',
	'06.10.2026;06.10.2026;Stadtwerke;Lastschrift;Abschlag Strom;384,56;EUR;-850,00;EUR'
].join('\n');

const dkb = [
	'"Konto";"Girokonto DE02120300000000202051"',
	'',
	'"Kontostand vom 20.10.2026:";"3.000,00 €"',
	'',
	'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
	'"07.10.26";"07.10.26";"Gebucht";"Max Müller";"Oliver Beispiel";"Miete Oktober";"Eingang";"DE12500105175407324931";"850,00";"";"";""',
	'"08.10.26";"08.10.26";"Gebucht";"Oliver Beispiel";"Hausmeister GmbH";"Rechnung 4711";"Ausgang";"DE89370400440532013000";"-120,50";"";"";""',
	'"09.10.26";"";"Vorgemerkt";"Erika Schmidt";"Oliver Beispiel";"Miete";"Eingang";"DE12500105175407324931";"640,00";"";"";""'
].join('\n');

const comdirect = [
	';',
	'"Umsätze Girokonto";"Zeitraum: 30 Tage"',
	'"Neuer Kontostand";"3.000,00 EUR"',
	'',
	'"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR";',
	'"10.10.2026";"10.10.2026";"Übertrag / Überweisung";"Auftraggeber: Max Müller Buchungstext: Miete Oktober Ref. 7XY123";"850,00";',
	'"11.10.2026";"11.10.2026";"Lastschrift / Belastung";"Empfänger: Stadtwerke Buchungstext: Abschlag Strom Ref. ABC";"-120,50";'
].join('\n');

function records(text: string) {
	const rows = parseCsv(text);
	const detected = detectPreset(rows);
	if (!detected) throw new Error('no preset');
	return {
		preset: detected.preset,
		results: mapRecords(
			toRecords(rows, detected.headerIndex),
			detected.preset.mapping,
			detected.preset.skip
		)
	};
}

function row(result: { ok: boolean }): BankRow {
	if (!('row' in result)) throw new Error('row expected');
	return result.row as BankRow;
}

describe('detectPreset and mapRecords', () => {
	it('reads a Sparkasse CSV-CAMT export', () => {
		const { preset, results } = records(sparkasseCamt);
		expect(preset.id).toBe('sparkasse-camt');
		expect(results.map(row)).toEqual([
			{
				bookingDate: '2026-10-01',
				valueDate: '2026-10-01',
				amount: 85000,
				counterpartName: 'Max Müller',
				counterpartIban: 'DE12500105175407324931',
				purpose: 'Miete Oktober',
				externalId: null
			},
			{
				bookingDate: '2026-10-02',
				valueDate: '2026-10-02',
				amount: -12050,
				counterpartName: 'Hausmeister GmbH',
				counterpartIban: 'DE89370400440532013000',
				purpose: 'Hausmeister September',
				externalId: null
			}
		]);
	});

	it('reads the older Sparkasse CSV-MT940 export', () => {
		const { preset, results } = records(sparkasseMt940);
		expect(preset.id).toBe('sparkasse-mt940');
		expect(row(results[0])).toMatchObject({
			bookingDate: '2026-10-03',
			amount: 64000,
			counterpartName: 'Erika Schmidt',
			counterpartIban: 'DE12500105175407324931',
			purpose: 'Miete Oktober Schmidt'
		});
	});

	it('reads a Volksbank export and strips the spaces of the IBAN', () => {
		const { preset, results } = records(volksbank);
		expect(preset.id).toBe('volksbank');
		expect(row(results[0])).toMatchObject({
			bookingDate: '2026-10-04',
			valueDate: '2026-10-04',
			amount: 64000,
			counterpartName: 'Erika Schmidt',
			counterpartIban: 'DE12500105175407324931',
			purpose: 'Miete 10/2026 Wohnung 2'
		});
	});

	it('reads an ING export below its preamble lines, without an IBAN column', () => {
		const { preset, results } = records(ing);
		expect(preset.id).toBe('ing');
		expect(results.map(row)).toEqual([
			{
				bookingDate: '2026-10-05',
				valueDate: '2026-10-05',
				amount: 85000,
				counterpartName: 'Max Müller',
				counterpartIban: null,
				purpose: 'Miete Oktober',
				externalId: null
			},
			{
				bookingDate: '2026-10-06',
				valueDate: '2026-10-06',
				amount: -85000,
				counterpartName: 'Stadtwerke',
				counterpartIban: null,
				purpose: 'Abschlag Strom',
				externalId: null
			}
		]);
	});

	it('reads a DKB export: payer for incoming, payee for outgoing, pending rows left out', () => {
		const { preset, results } = records(dkb);
		expect(preset.id).toBe('dkb');
		expect(results).toEqual([
			{
				ok: true,
				row: {
					bookingDate: '2026-10-07',
					valueDate: '2026-10-07',
					amount: 85000,
					counterpartName: 'Max Müller',
					counterpartIban: 'DE12500105175407324931',
					purpose: 'Miete Oktober',
					externalId: null
				}
			},
			{
				ok: true,
				row: {
					bookingDate: '2026-10-08',
					valueDate: '2026-10-08',
					amount: -12050,
					counterpartName: 'Hausmeister GmbH',
					counterpartIban: 'DE89370400440532013000',
					purpose: 'Rechnung 4711',
					externalId: null
				}
			},
			{ ok: false, reason: 'Noch nicht gebucht (vorgemerkt)' }
		]);
	});

	it('reads a comdirect export and splits counterpart and purpose out of the text', () => {
		const { preset, results } = records(comdirect);
		expect(preset.id).toBe('comdirect');
		expect(results.map(row)).toEqual([
			{
				bookingDate: '2026-10-10',
				valueDate: '2026-10-10',
				amount: 85000,
				counterpartName: 'Max Müller',
				counterpartIban: null,
				purpose: 'Miete Oktober',
				externalId: null
			},
			{
				bookingDate: '2026-10-11',
				valueDate: '2026-10-11',
				amount: -12050,
				counterpartName: 'Stadtwerke',
				counterpartIban: null,
				purpose: 'Abschlag Strom',
				externalId: null
			}
		]);
	});

	it('knows no preset for a spreadsheet of its own', () => {
		const rows = parseCsv('Datum;Text;Betrag\n01.10.2026;Miete;850,00');
		expect(detectPreset(rows)).toBeUndefined();
	});
});

describe('genericHeaderRow', () => {
	it('takes the first row as wide as the widest, skipping preamble lines', () => {
		const rows = parseCsv('Export;20.10.2026\n\nDatum;Text;Betrag\n01.10.2026;Miete;850,00');
		expect(genericHeaderRow(rows)).toBe(1);
	});

	it('is -1 for an empty file or one without columns', () => {
		expect(genericHeaderRow([])).toBe(-1);
		expect(genericHeaderRow([['Kontoauszug']])).toBe(-1);
	});
});

describe('mapRecord', () => {
	const mapping = {
		bookingDate: 'Datum',
		valueDate: null,
		amount: 'Betrag',
		counterpartName: 'Name',
		counterpartIban: null,
		purpose: 'Text'
	};

	it('names the invalid date or amount in German', () => {
		expect(mapRecord({ Datum: 'gestern', Betrag: '1', Name: '', Text: '' }, mapping)).toEqual({
			ok: false,
			reason: 'Ungültiges Datum „gestern“'
		});
		expect(mapRecord({ Datum: '01.10.2026', Betrag: 'viel', Name: '', Text: '' }, mapping)).toEqual(
			{
				ok: false,
				reason: 'Ungültiger Betrag „viel“'
			}
		);
	});

	it('collapses whitespace and leaves missing optional columns empty', () => {
		expect(
			mapRecord(
				{ Datum: '2026-10-01', Betrag: '1.234,56', Name: ' Max   Müller ', Text: '' },
				mapping
			)
		).toEqual({
			ok: true,
			row: {
				bookingDate: '2026-10-01',
				valueDate: null,
				amount: 123456,
				counterpartName: 'Max Müller',
				counterpartIban: null,
				purpose: '',
				externalId: null
			}
		});
	});
});

describe('fingerprints', () => {
	const line: BankRow = {
		bookingDate: '2026-10-01',
		valueDate: '2026-10-01',
		amount: 85000,
		counterpartName: 'Max  Müller',
		counterpartIban: 'DE12500105175407324931',
		purpose: ' Miete Oktober ',
		externalId: null
	};

	it('hashes bookingDate|amount|name|iban|purpose|occurrence, normalized', () => {
		expect(fingerprintInput(line, 0)).toBe(
			'2026-10-01|85000|Max Müller|DE12500105175407324931|Miete Oktober|0'
		);
	});

	it('numbers identical lines within a file and hashes with SHA-256', async () => {
		const rows = await fingerprintRows([line, { ...line, amount: -100 }, line]);
		expect(rows.map((row) => row.occurrence)).toEqual([0, 0, 1]);
		// sha256 of the inputs above with occurrence 0 and 1, computed once with Node's crypto.
		expect(rows[0].fingerprint).toBe(
			'82f93249ca9ba06a85dd58dc671cf7cb454965ccf9162222a4196175b4211f3a'
		);
		expect(rows[2].fingerprint).toBe(
			'ea9eccd21edf98b9a7b5dae9e83262fbbf7e73886aa272ebebfe189b06edff0c'
		);
		expect(rows[1].fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(rows[1].fingerprint).not.toBe(rows[0].fingerprint);
	});

	it('gives the same fingerprints for the same file again', async () => {
		const first = await fingerprintRows([line, line]);
		const second = await fingerprintRows([line, line]);
		expect(second.map((row) => row.fingerprint)).toEqual(first.map((row) => row.fingerprint));
	});
});

describe('base64', () => {
	it('round-trips bytes, including a windows-1252 ü', () => {
		const bytes = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a]);
		expect(bytesToBase64(bytes)).toBe('TfxsbGVyCg==');
		expect(Array.from(base64ToBytes('TfxsbGVyCg=='))).toEqual(Array.from(bytes));
	});

	it('handles more than one chunk', () => {
		const bytes = new Uint8Array(70_000).map((_, index) => index % 251);
		expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
	});
});

describe('ibans', () => {
	it('normalizes and formats in groups of four', () => {
		expect(normalizeIban(' de12 5001 0517 5407 3249 31 ')).toBe('DE12500105175407324931');
		expect(normalizeIban('')).toBeNull();
		expect(formatIban('DE12500105175407324931')).toBe('DE12 5001 0517 5407 3249 31');
	});
});

describe('splitComdirectText', () => {
	it('keeps the whole text as purpose when it has no parts', () => {
		expect(splitComdirectText('Zinsen 3. Quartal')).toEqual({
			counterpartName: '',
			purpose: 'Zinsen 3. Quartal'
		});
	});
});

describe('rules', () => {
	const transaction = {
		amount: 85000,
		counterpartName: 'Max Müller',
		counterpartIban: 'DE12500105175407324931',
		purpose: 'Miete Oktober Wohnung 2'
	};
	const rules: Rule[] = [
		{ id: 'r1', leaseId: 'l1', field: 'purpose', pattern: 'wohnung 1', confirmed: true },
		{ id: 'r2', leaseId: 'l2', field: 'counterpartName', pattern: 'müller', confirmed: false },
		{
			id: 'r3',
			leaseId: 'l3',
			field: 'counterpartIban',
			pattern: 'DE12 5001 0517 5407 3249 31',
			confirmed: true
		}
	];

	it('matches case-insensitively, IBANs without spaces', () => {
		expect(ruleMatches(rules[0], transaction)).toBe(false);
		expect(ruleMatches(rules[1], transaction)).toBe(true);
		expect(ruleMatches(rules[2], transaction)).toBe(true);
		expect(ruleMatches({ field: 'purpose', pattern: '' }, transaction)).toBe(false);
		expect(ruleMatches(rules[2], { ...transaction, counterpartIban: null })).toBe(false);
	});

	it('applies the first confirmed rule to incoming amounts only', () => {
		expect(applyRules(rules, transaction)).toBe('l3');
		expect(applyRules(rules, { ...transaction, amount: -85000 })).toBeUndefined();
		expect(applyRules([rules[1]], transaction)).toBeUndefined();
	});

	it('suggests by rule, then IBAN, then last name, then unit name', () => {
		const leases = [
			{ id: 'l1', lastNames: ['Schmidt'], unitNames: ['Wohnung 1'] },
			{ id: 'l2', lastNames: ['Müller'], unitNames: ['Wohnung 2', 'Stellplatz 3'] }
		];
		const leaseByIban = new Map([['DE12500105175407324931', 'l1']]);
		const outgoing = { ...transaction, amount: -85000 };

		expect(suggestLease(outgoing, { rules, leaseByIban, leases })).toEqual({
			leaseId: 'l2',
			source: 'rule'
		});
		expect(suggestLease(outgoing, { rules: [], leaseByIban, leases })).toEqual({
			leaseId: 'l1',
			source: 'iban'
		});
		expect(suggestLease(outgoing, { rules: [], leaseByIban: new Map(), leases })).toEqual({
			leaseId: 'l2',
			source: 'name'
		});
		expect(
			suggestLease(
				{ ...outgoing, counterpartName: 'Unbekannt', purpose: 'Miete Stellplatz 3' },
				{ rules: [], leaseByIban: new Map(), leases }
			)
		).toEqual({ leaseId: 'l2', source: 'unit' });
		expect(
			suggestLease(
				{ ...outgoing, counterpartName: 'Unbekannt', purpose: 'Spende' },
				{ rules: [], leaseByIban: new Map(), leases }
			)
		).toBeUndefined();
	});

	it('does not search for names shorter than three characters', () => {
		const leases = [{ id: 'l1', lastNames: ['Li'], unitNames: ['EG'] }];
		expect(
			suggestLease(
				{ ...transaction, counterpartName: 'Lisa Egger', purpose: 'Miete' },
				{ rules: [], leaseByIban: new Map(), leases }
			)
		).toBeUndefined();
	});

	it('remembers the IBAN when there is one, else the name', () => {
		expect(rememberedRule(transaction)).toEqual({
			field: 'counterpartIban',
			pattern: 'DE12500105175407324931'
		});
		expect(rememberedRule({ counterpartName: ' Max  Müller', counterpartIban: null })).toEqual({
			field: 'counterpartName',
			pattern: 'Max Müller'
		});
		expect(rememberedRule({ counterpartName: '', counterpartIban: null })).toBeUndefined();
	});
});
