import { beforeEach, describe, expect, it } from 'vitest';
import { parseBankFile } from '../../domain/bank-matching';
import type { Database } from '../db';
import { createLease } from '../leases';
import { contextA, leaseInput, seedTenant, seedUnit, testDatabase } from '../testing';
import { createBankAccount } from './accounts';
import { createContraAccount } from './contra-accounts';
import { datevExport, datevFile, getDatevNumbers, setDatevNumbers } from './datev';
import { commitImport } from './imports';
import { assignExpense, assignOther, assignTransaction, listTransactions } from './transactions';

const statement = (lines: string[]) =>
	[
		'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
		...lines
	].join('\n');
const line = (iban: string, day: string, purpose: string, name: string, amount: string) =>
	`${iban};${day};${day};X;${purpose};;;;;;;${name};DE89370400440532013000;INGDDEFFXXX;${amount};EUR;Umsatz gebucht`;
const main = 'DE02120300000000202051';
const reserve = 'DE75512108001245126199';

let db: Database;
let leaseId: string;
let accounts: Record<string, string>;
let banks: Record<string, string>;

beforeEach(async () => {
	db = await testDatabase();
	const unit = await seedUnit(db, 'a');
	const tenantId = await seedTenant(db, 'a', { lastName: 'Müller' });
	const lease = await createLease(db, contextA, leaseInput(unit.unitId, { tenantIds: [tenantId] }));
	if (!lease.ok) throw new Error('setup failed');
	leaseId = lease.id;
	banks = {};
	for (const [name, iban, ledgerNumber] of [
		['Mietkonto', main, '1200'],
		['Rücklage', reserve, null]
	] as const) {
		const bank = await createBankAccount(db, contextA, {
			name,
			iban,
			bic: null,
			holder: 'Oliver',
			ledgerNumber
		});
		if (!bank.ok) throw new Error('setup failed');
		banks[iban] = bank.id;
	}
	accounts = {};
	for (const [number, name, kind, expenseCategory] of [
		['8005', 'Mieten', 'rent', null],
		['8006', 'NK', 'operating_costs', null],
		['4401', 'Grundsteuer', 'expense', 'operating_costs'],
		['1890', 'Kapitalerträge', 'capital_income', null],
		[null, 'Privat ohne Nummer', 'private', null]
	] as const) {
		const created = await createContraAccount(db, contextA, {
			number,
			name,
			kind,
			expenseCategory,
			propertyId: null
		});
		if (!created.ok) throw new Error(created.reason);
		accounts[name] = created.id;
	}
	for (const [iban, lines] of [
		[
			main,
			[
				line(main, '01.03.25', 'Miete März', 'Max Müller', '800,00'),
				line(main, '15.03.25', 'Grundsteuer Q1', 'Stadtkasse', '-210,00'),
				line(main, '31.03.25', 'Umbuchung', 'Oliver', '-500,00'),
				line(main, '02.01.26', 'Miete Januar', 'Max Müller', '800,00')
			]
		],
		[reserve, [line(reserve, '31.03.25', 'Zinsen', 'Bank', '3,12')]]
	] as const) {
		const parsed = parseBankFile(statement([...lines]));
		if (!parsed) throw new Error('no table');
		await commitImport(db, contextA, banks[iban], 'umsatz.csv', parsed.results);
	}
	const open = (await listTransactions(db, 'a', { status: 'unmatched' })).rows;
	const find = (purpose: string) => open.find((row) => row.purpose === purpose)!.id;
	for (const purpose of ['Miete März', 'Miete Januar']) {
		await assignTransaction(db, contextA, find(purpose), {
			target: 'rent',
			parts: [{ leaseId, amount: 80000 }]
		});
	}
	await assignExpense(db, contextA, find('Grundsteuer Q1'), {
		category: null,
		scope: { kind: 'portfolio' },
		description: 'Grundsteuer',
		contraAccountId: accounts.Grundsteuer
	});
	await assignOther(db, contextA, find('Umbuchung'), {
		kind: null,
		contraAccountId: accounts['Privat ohne Nummer'],
		propertyId: null,
		description: ''
	});
	await assignOther(db, contextA, find('Zinsen'), {
		kind: null,
		contraAccountId: accounts['Kapitalerträge'],
		propertyId: null,
		description: 'Zinsen'
	});
});

describe('datevExport', () => {
	it('books from the bank account to the Gegenkonto, rent in two parts', async () => {
		const data = await datevExport(db, 'a', '2025-01-01', '2025-12-31');
		expect(
			data.bookings.map((row) => [row.date, row.amount, row.account, row.contraAccount])
		).toEqual([
			['2025-03-01', 60000, '1200', '8005'],
			['2025-03-01', 20000, '1200', '8006'],
			['2025-03-15', -21000, '1200', '4401']
		]);
		expect(data.bookings[0].text).toBe('Max Müller Miete März');
		// Interest on the account without Kontonummer, the Privatentnahme on a Gegenkonto without.
		expect(data.skipped.map((row) => [row.date, row.reason])).toEqual([
			['2025-03-31', 'no-contra-number'],
			['2025-03-31', 'no-ledger-number']
		]);
		expect(data.accountLength).toBe(4);
		expect(data.uneven).toEqual([]);
		// Another account sees nothing.
		expect((await datevExport(db, 'b', '2025-01-01', '2025-12-31')).bookings).toEqual([]);
	});

	it('writes the file in Windows-1252 with the saved numbers', async () => {
		await setDatevNumbers(db, contextA, { advisorNumber: '29098', clientNumber: '55003' });
		const numbers = await getDatevNumbers(db, 'a');
		expect(numbers).toEqual({ advisorNumber: '29098', clientNumber: '55003' });
		const data = await datevExport(db, 'a', '2026-01-01', '2026-01-31');
		const file = datevFile(
			{ advisorNumber: '29098', clientNumber: '55003' },
			data,
			'2026-01-01',
			'2026-01-31'
		);
		const text = new TextDecoder('windows-1252').decode(file);
		const lines = text.split('\r\n');
		expect(lines[0]).toContain(';29098;55003;20260101;4;20260101;20260131;"Bank 2026";');
		expect(lines.slice(2, 4)).toEqual([
			'600,00;"S";"EUR";;;"";1200;8005;"";0201;"";"";;"Max Müller Miete Januar"',
			'200,00;"S";"EUR";;;"";1200;8006;"";0201;"";"";;"Max Müller Miete Januar"'
		]);
	});
});
