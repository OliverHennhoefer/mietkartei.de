import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
	CAMT_PRESET_ID,
	looksLikeXml,
	parseBankUpload,
	parseCamt,
	parseCamtAmount,
	restrictToAccount
} from './camt';

// camt files as banks write them: 001.02 (still the most common in Germany) with a rent, an
// outgoing payment, a pending line, a collective transfer of two tenants and a foreign currency;
// 001.08 with the paths that changed (Sts/Cd, Pty/Nm, DtTm, Amt directly in TxDtls).

const ownIban = 'DE02120300000000202051';

const camt053v2 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG1</MsgId><CreDtTm>2026-10-31T20:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>STMT-10</Id>
      <Acct><Id><IBAN>${ownIban}</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">850.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-01</Dt></BookgDt>
        <ValDt><Dt>2026-10-02</Dt></ValDt>
        <AcctSvcrRef>REF-1</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <AmtDtls><TxAmt><Amt Ccy="EUR">850.00</Amt></TxAmt></AmtDtls>
          <RltdPties>
            <Dbtr><Nm>Max  Müller</Nm></Dbtr>
            <DbtrAcct><Id><IBAN>DE12500105175407324931</IBAN></Id></DbtrAcct>
            <Cdtr><Nm>Vera Vermieterin</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>${ownIban}</IBAN></Id></CdtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>Miete Oktober</Ustrd><Ustrd>Wohnung 2</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
        <AddtlNtryInf>GUTSCHR. UEBERWEISUNG</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">120.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-02</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <RltdPties>
            <Dbtr><Nm>Vera Vermieterin</Nm></Dbtr>
            <Cdtr><Nm>Hausmeister &amp; Söhne GmbH</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></CdtrAcct>
          </RltdPties>
        </TxDtls></NtryDtls>
        <AddtlNtryInf>ONLINE-UEBERWEISUNG</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">640.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>PDNG</Sts>
        <BookgDt><Dt>2026-10-03</Dt></BookgDt>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">1500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-04</Dt></BookgDt>
        <AcctSvcrRef>REF-BATCH</AcctSvcrRef>
        <NtryDtls>
          <Btch><NbOfTxs>2</NbOfTxs></Btch>
          <TxDtls>
            <AmtDtls><TxAmt><Amt Ccy="EUR">900.00</Amt></TxAmt></AmtDtls>
            <RltdPties><Dbtr><Nm>Erika Schmidt</Nm></Dbtr></RltdPties>
            <RmtInf><Ustrd>Miete Schmidt</Ustrd></RmtInf>
          </TxDtls>
          <TxDtls>
            <AmtDtls><TxAmt><Amt Ccy="EUR">600.00</Amt></TxAmt></AmtDtls>
            <RltdPties><UltmtDbtr><Nm>Jobcenter</Nm></UltmtDbtr></RltdPties>
            <RmtInf><Ustrd>KdU Meier</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">50.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-05</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const camt053v8 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Acct><Id><IBAN>DE75 5121 0800 1245 1261 99</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="EUR">75</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><DtTm>2026-11-03T10:15:00+01:00</DtTm></BookgDt>
        <NtryDtls><TxDtls>
          <Refs><AcctSvcrRef>TX-7</AcctSvcrRef></Refs>
          <Amt Ccy="EUR">75.00</Amt>
          <CdtDbtInd>DBIT</CdtDbtInd>
          <RltdPties><Cdtr><Pty><Nm>Stadtwerke</Nm></Pty></Cdtr></RltdPties>
          <AddtlTxInf>Abschlag Strom Allgemein</AddtlTxInf>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('parseCamtAmount', () => {
	it('reads decimals with a dot and up to two places', () => {
		expect(parseCamtAmount('850.00')).toBe(85000);
		expect(parseCamtAmount(' 75 ')).toBe(7500);
		expect(parseCamtAmount('0.5')).toBe(50);
		for (const value of ['', '850,00', '-5.00', '1.234', 'abc']) {
			expect(parseCamtAmount(value), value).toBeUndefined();
		}
	});
});

describe('parseCamt', () => {
	it('reads a camt.053.001.02 statement, splitting the collective transfer', () => {
		const parsed = parseCamt(camt053v2);
		expect(parsed?.name).toBe('camt.053 (XML-Kontoauszug)');
		expect(parsed?.accountIbans).toEqual(Array(6).fill(ownIban));
		expect(parsed?.results).toEqual([
			{
				ok: true,
				row: {
					bookingDate: '2026-10-01',
					valueDate: '2026-10-02',
					amount: 85000,
					counterpartName: 'Max Müller',
					counterpartIban: 'DE12500105175407324931',
					purpose: 'Miete Oktober Wohnung 2',
					externalId: 'REF-1'
				}
			},
			{
				ok: true,
				row: {
					bookingDate: '2026-10-02',
					valueDate: null,
					amount: -12050,
					counterpartName: 'Hausmeister & Söhne GmbH',
					counterpartIban: 'DE89370400440532013000',
					purpose: 'ONLINE-UEBERWEISUNG',
					externalId: null
				}
			},
			{ ok: false, reason: 'Noch nicht gebucht (vorgemerkt)' },
			{
				ok: true,
				row: {
					bookingDate: '2026-10-04',
					valueDate: null,
					amount: 90000,
					counterpartName: 'Erika Schmidt',
					counterpartIban: null,
					purpose: 'Miete Schmidt',
					externalId: 'REF-BATCH'
				}
			},
			{
				ok: true,
				row: {
					bookingDate: '2026-10-04',
					valueDate: null,
					amount: 60000,
					counterpartName: 'Jobcenter',
					counterpartIban: null,
					purpose: 'KdU Meier',
					externalId: 'REF-BATCH'
				}
			},
			{ ok: false, reason: 'Betrag in CHF, nur Euro wird importiert' }
		]);
	});

	it('reads the paths of camt.053.001.08', () => {
		const parsed = parseCamt(camt053v8);
		expect(parsed?.accountIbans).toEqual(['DE75512108001245126199']);
		expect(parsed?.results).toEqual([
			{
				ok: true,
				row: {
					bookingDate: '2026-11-03',
					valueDate: null,
					amount: -7500,
					counterpartName: 'Stadtwerke',
					counterpartIban: null,
					purpose: 'Abschlag Strom Allgemein',
					externalId: 'TX-7'
				}
			}
		]);
	});

	it('keeps a batch whose parts do not add up as one row without counterpart', () => {
		const parsed = parseCamt(camt053v2.replace('600.00', '500.00'));
		const batch = parsed?.results.filter(
			(result) => result.ok && result.row.bookingDate === '2026-10-04'
		);
		expect(batch).toEqual([
			{
				ok: true,
				row: {
					bookingDate: '2026-10-04',
					valueDate: null,
					amount: 150000,
					counterpartName: '',
					counterpartIban: null,
					purpose: 'Sammelbuchung mit 2 Posten',
					externalId: 'REF-BATCH'
				}
			}
		]);
	});

	it('names an invalid date or amount', () => {
		const parsed = parseCamt(
			camt053v8.replace('<DtTm>2026-11-03T10:15:00+01:00</DtTm>', '<Dt>03.11.2026</Dt>')
		);
		expect(parsed?.results).toEqual([{ ok: false, reason: 'Ungültiges Datum „03.11.2026“' }]);
		expect(parseCamt(camt053v8.replace('>75<', '>7,5<'))?.results).toEqual([
			{ ok: false, reason: 'Ungültiger Betrag „7,5“' }
		]);
	});

	it('names camt.052 and camt.054 by their message', () => {
		const report = camt053v8
			.replaceAll('BkToCstmrStmt', 'BkToCstmrAcctRpt')
			.replaceAll('Stmt>', 'Rpt>');
		expect(parseCamt(report)?.name).toBe('camt.052 (XML-Umsatzbericht)');
		expect(parseCamt(report)?.results).toHaveLength(1);
	});

	it('is undefined for other XML and for broken XML', () => {
		expect(parseCamt('<Document><pain.001/></Document>')).toBeUndefined();
		expect(parseCamt('<html><body/></html>')).toBeUndefined();
		expect(parseCamt(camt053v2.slice(0, 500))).toBeUndefined();
	});
});

describe('parseBankUpload', () => {
	it('reads a camt file as the camt preset', () => {
		const parsed = parseBankUpload(strToU8(`\ufeff${camt053v8}`));
		expect(parsed.ok && parsed.file.preset).toEqual({
			id: CAMT_PRESET_ID,
			name: 'camt.053 (XML-Kontoauszug)'
		});
		expect(parsed.ok && parsed.file.results).toHaveLength(1);
	});

	it('reads the XML files of a ZIP in numbered order, other files left out', () => {
		const zip = zipSync({
			'auszug-10.xml': strToU8(camt053v8),
			'auszug-9.xml': strToU8(camt053v2),
			'liesmich.txt': strToU8('Hallo'),
			'__MACOSX/._auszug-9.xml': strToU8('x')
		});
		const parsed = parseBankUpload(zip);
		expect(parsed.ok && parsed.file.results).toHaveLength(7);
		expect(parsed.ok && parsed.accountIbans?.at(-1)).toBe('DE75512108001245126199');
	});

	it('reads a statement repeated in a ZIP once, by its id or the bank reference', () => {
		const reasons = (zip: Uint8Array) => {
			const parsed = parseBankUpload(zip);
			return parsed.ok
				? parsed.file.results.map((result) => (result.ok ? 'ok' : result.reason))
				: [];
		};
		const repeated = 'Schon in einem anderen Auszug der Datei';
		// A copy under another name: every importable entry of the second copy, by the statement id.
		const copy = reasons(zipSync({ 'a.xml': strToU8(camt053v2), 'b.xml': strToU8(camt053v2) }));
		expect(copy.slice(6)).toEqual([
			repeated,
			repeated,
			'Noch nicht gebucht (vorgemerkt)',
			repeated,
			'Betrag in CHF, nur Euro wird importiert'
		]);
		expect(copy.slice(0, 6)).not.toContain(repeated);
		// An intraday report with another id and the statement: the entry with the same reference.
		const report = camt053v2
			.replaceAll('BkToCstmrStmt', 'BkToCstmrAcctRpt')
			.replaceAll('Stmt>', 'Rpt>')
			.replace('STMT-10', 'RPT-1');
		const overlap = reasons(zipSync({ 'a.xml': strToU8(report), 'b.xml': strToU8(camt053v2) }));
		expect(overlap.filter((reason) => reason === repeated)).toHaveLength(2);
	});

	it('imports the booked version of an entry a report listed as pending', () => {
		const booked = camt053v8.replace('<Ntry>', '<Ntry><AcctSvcrRef>R-9</AcctSvcrRef>');
		const pending = booked
			.replaceAll('BkToCstmrStmt', 'BkToCstmrAcctRpt')
			.replaceAll('Stmt>', 'Rpt>')
			.replace('<Cd>BOOK</Cd>', '<Cd>PDNG</Cd>');
		const parsed = parseBankUpload(
			zipSync({ 'a.xml': strToU8(pending), 'b.xml': strToU8(booked) })
		);
		expect(parsed.ok && parsed.file.results.map((result) => result.ok)).toEqual([false, true]);
	});

	it('names what is wrong with an upload it cannot read', () => {
		expect(parseBankUpload(zipSync({ 'a.txt': strToU8('x') }))).toEqual({
			ok: false,
			reason: 'Die ZIP-Datei enthält nicht nur camt-Kontoauszüge (XML).'
		});
		expect(parseBankUpload(zipSync({ 'a.xml': strToU8('<html/>') })).ok).toBe(false);
		expect(parseBankUpload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toEqual({
			ok: false,
			reason: 'Die ZIP-Datei lässt sich nicht entpacken.'
		});
		expect(parseBankUpload(strToU8('<html></html>'))).toEqual({
			ok: false,
			reason: 'Die XML-Datei ist kein lesbarer camt-Kontoauszug.'
		});
		expect(parseBankUpload(strToU8(''))).toEqual({
			ok: false,
			reason: 'Die Datei enthält keine Tabelle mit Spalten.'
		});
	});

	it('still reads a CSV export, without account IBANs', () => {
		const csv =
			'Buchung;Valuta;Auftraggeber/Empfänger;Verwendungszweck;Betrag\n01.10.2026;01.10.2026;Max;Miete;850,00';
		const parsed = parseBankUpload(strToU8(csv));
		expect(parsed.ok && parsed.file.preset?.id).toBe('ing');
		expect(parsed.ok && parsed.accountIbans).toBeNull();
	});
});

describe('restrictToAccount', () => {
	it('marks the rows of another account invalid, keeps unknown accounts', () => {
		const row = {
			bookingDate: '2026-10-01',
			valueDate: null,
			amount: 100,
			counterpartName: '',
			counterpartIban: null,
			purpose: '',
			externalId: null
		};
		const results = [
			{ ok: true, row } as const,
			{ ok: true, row } as const,
			{ ok: true, row } as const,
			{ ok: false, reason: 'x' } as const
		];
		expect(
			restrictToAccount(
				results,
				[ownIban, 'DE75512108001245126199', null, 'DE75512108001245126199'],
				'de02 1203 0000 0000 2020 51'
			)
		).toEqual([
			results[0],
			{ ok: false, reason: 'Auszug eines anderen Kontos (DE75 5121 0800 1245 1261 99)' },
			results[2],
			results[3]
		]);
		expect(restrictToAccount(results, null, ownIban)).toBe(results);
	});
});

describe('looksLikeXml', () => {
	it('tells XML from CSV', () => {
		expect(looksLikeXml('\ufeff  <?xml version="1.0"?><a/>')).toBe(true);
		expect(looksLikeXml('Buchungstag;Betrag')).toBe(false);
	});
});
