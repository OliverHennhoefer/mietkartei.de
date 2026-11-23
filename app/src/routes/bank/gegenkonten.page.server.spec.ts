import { beforeEach, describe, expect, it } from 'vitest';
import { parseBankFile } from '#lib/domain/bank-matching.ts';
import { createBankAccount, listBankAccounts } from '#lib/server/bank/accounts.ts';
import { createContraAccount, listContraAccounts } from '#lib/server/bank/contra-accounts.ts';
import { commitImport } from '#lib/server/bank/imports.ts';
import { listAssignments, listTransactions } from '#lib/server/bank/transactions.ts';
import type { Database } from '#lib/server/db/index.ts';
import {
	contextA,
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions as contraActions, load as loadContra } from './gegenkonten/+page.server';
import { actions as accountActions } from './konten/+page.server';
import { actions, load } from './+page.server';

// Gegenkonten: their page, booking a transaction as an expense or other booking on one, and the
// Kontonummer of a bank account.

const csv = [
	'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
	'DE02120300000000202051;15.10.26;15.10.26;X;Grundsteuer Q4;;;;;;;Stadtkasse;DE89370400440532013000;COBADEFFXXX;-210,00;EUR;Umsatz gebucht',
	'DE02120300000000202051;30.10.26;30.10.26;X;Zinsen;;;;;;;Bank;DE75512108001245126199;INGDDEFFXXX;3,12;EUR;Umsatz gebucht'
].join('\n');

let db: Database;
let propertyId: string;
let bankAccountId: string;

beforeEach(async () => {
	db = await testDatabase();
	const unit = await seedUnit(db, 'a');
	propertyId = unit.propertyId;
	const tenantId = await seedTenant(db, 'a', { lastName: 'Müller' });
	await seedLease(db, 'a', unit.unitId, { tenantIds: [tenantId] });
	const created = await createBankAccount(db, contextA, {
		name: 'Mietkonto',
		iban: 'DE02120300000000202051',
		bic: null,
		holder: 'Oliver'
	});
	if (!created.ok) throw new Error('setup failed');
	bankAccountId = created.id;
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

const fields = {
	number: '4401',
	name: 'Grundsteuer',
	kind: 'expense',
	expenseCategory: 'operating_costs',
	propertyId: ''
};

describe('bank/gegenkonten', () => {
	it('creates, refuses, edits and deletes a Gegenkonto', async () => {
		expect(await run(contraActions.create, { form: fields })).toEqual({ data: { created: true } });
		expect(
			await run(contraActions.create, { form: { ...fields, expenseCategory: '' } })
		).toMatchObject({
			fail: 400,
			data: { errors: { expenseCategory: 'Bitte wähle die Kategorie der Ausgaben aus.' } }
		});
		expect(await run(contraActions.create, { form: fields })).toMatchObject({
			fail: 400,
			data: {
				errors: { number: 'Ein Gegenkonto mit dieser Nummer gibt es schon.' },
				values: { number: '4401' }
			}
		});
		expect(
			await run(contraActions.create, {
				form: { ...fields, number: '8005', kind: 'rent', propertyId: crypto.randomUUID() }
			})
		).toMatchObject({
			fail: 400,
			data: { errors: { propertyId: 'Dieses Objekt gibt es nicht.' } }
		});
		expect(
			await run(contraActions.create, {
				form: { ...fields, number: '8005', name: 'Mieten', kind: 'rent', propertyId }
			})
		).toEqual({ data: { created: true } });

		const [tax, rent] = await listContraAccounts(db, 'a');
		const page = (await run(loadContra, { url: `/bank/gegenkonten?bearbeiten=${rent.id}` })) as {
			data: { contraAccounts: unknown[]; editing: { id: string }; properties: unknown[] };
		};
		expect(page.data.contraAccounts).toHaveLength(2);
		expect(page.data.editing.id).toBe(rent.id);
		expect(page.data.properties).toHaveLength(1);

		expect(
			await run(contraActions.update, { form: { ...fields, id: rent.id, name: '' } })
		).toMatchObject({ fail: 400, data: { edit: true, errors: { name: expect.any(String) } } });
		expect(await run(contraActions.update, { form: { ...fields, id: rent.id } })).toMatchObject({
			fail: 400,
			data: { edit: true, errors: { number: 'Ein Gegenkonto mit dieser Nummer gibt es schon.' } }
		});
		expect(
			await run(contraActions.update, { form: { ...fields, id: crypto.randomUUID() } })
		).toMatchObject({ error: 404 });
		expect(
			await run(contraActions.update, { form: { ...fields, id: tax.id, name: 'Grundsteuer B' } })
		).toEqual({ redirect: '/bank/gegenkonten' });
		expect((await listContraAccounts(db, 'a'))[0].name).toBe('Grundsteuer B');

		expect(await run(contraActions.delete, { form: { id: crypto.randomUUID() } })).toMatchObject({
			error: 404
		});
		expect(await run(contraActions.delete, { form: { id: tax.id } })).toEqual({
			redirect: '/bank/gegenkonten'
		});
		expect(await listContraAccounts(db, 'a')).toHaveLength(1);
	});
});

async function importFile() {
	await commitImport(db, contextA, bankAccountId, 'umsatz.csv', parseBankFile(csv)!.results);
	const rows = (await listTransactions(db, 'a', { status: 'unmatched' })).rows;
	return {
		tax: rows.find((row) => row.amount < 0)!,
		interest: rows.find((row) => row.amount > 0)!
	};
}

async function contra(number: string, name: string, kind: 'expense' | 'capital_income') {
	const created = await createContraAccount(db, contextA, {
		number,
		name,
		kind,
		expenseCategory: kind === 'expense' ? 'operating_costs' : null,
		propertyId: null
	});
	if (!created.ok) throw new Error(created.reason);
	return created.id;
}

describe('bank: booking on Gegenkonten', () => {
	it('books an expense on a Gegenkonto and suggests it next time', async () => {
		const taxAccount = await contra('4401', 'Grundsteuer', 'expense');
		const { tax } = await importFile();
		const unknown = { id: tax.id, scope: '', description: 'Grundsteuer' };
		expect(
			await run(actions.expense, { form: { ...unknown, contraAccountId: crypto.randomUUID() } })
		).toMatchObject({
			fail: 400,
			data: { expenseErrors: { contraAccountId: 'Dieses Gegenkonto gibt es nicht.' } }
		});
		const page = (await run(load, { url: '/bank' })) as {
			data: { contraAccounts: { id: string; label: string }[] };
		};
		expect(page.data.contraAccounts.map((row) => row.label)).toEqual(['4401 Grundsteuer']);
		expect(
			await run(actions.expense, { form: { ...unknown, contraAccountId: taxAccount } })
		).toEqual({ data: { assigned: tax.id } });
		const [assignment] = (await listAssignments(db, 'a', [tax.id])).get(tax.id)!;
		expect(assignment).toMatchObject({ kind: 'expense', contraAccountId: taxAccount });
	});

	it('books interest as Kapitalertrag and refuses what does not fit', async () => {
		const capital = await contra('1890', 'Kapitalerträge', 'capital_income');
		const { interest } = await importFile();
		expect(await run(actions.other, { form: { id: interest.id, kind: '' } })).toMatchObject({
			fail: 400,
			data: { otherErrors: { kind: expect.any(String) } }
		});
		expect(
			await run(actions.other, {
				form: { id: interest.id, kind: 'private', propertyId: crypto.randomUUID() }
			})
		).toMatchObject({
			fail: 400,
			data: { otherErrors: { propertyId: 'Dieses Objekt gibt es nicht.' } }
		});
		expect(
			await run(actions.other, {
				form: { id: interest.id, contraAccountId: crypto.randomUUID() }
			})
		).toMatchObject({
			fail: 400,
			data: { otherErrors: { contraAccountId: 'Dieses Gegenkonto gibt es nicht.' } }
		});
		expect(
			await run(actions.other, { form: { id: crypto.randomUUID(), kind: 'private' } })
		).toMatchObject({ error: 404 });
		expect(
			await run(actions.other, {
				form: { id: interest.id, contraAccountId: capital, description: 'Zinsen Oktober' }
			})
		).toEqual({ data: { assigned: interest.id } });
		expect(await run(actions.other, { form: { id: interest.id, kind: 'private' } })).toMatchObject({
			fail: 400,
			data: { otherErrors: { kind: 'Dieser Umsatz ist nicht mehr offen.' } }
		});
	});
});

describe('bank/konten: Kontonummer', () => {
	it('sets and clears the Kontonummer of a bank account', async () => {
		expect(
			await run(accountActions.ledger, { form: { id: bankAccountId, ledgerNumber: '1200' } })
		).toEqual({ redirect: '/bank/konten' });
		expect((await listBankAccounts(db, 'a'))[0].ledgerNumber).toBe('1200');
		expect(
			await run(accountActions.ledger, {
				form: { id: bankAccountId, ledgerNumber: '1'.repeat(30) }
			})
		).toMatchObject({ fail: 400, data: { ledgerErrors: { ledgerNumber: expect.any(String) } } });
		expect(
			await run(accountActions.ledger, { form: { id: crypto.randomUUID(), ledgerNumber: '' } })
		).toMatchObject({ error: 404 });
		expect(
			await run(accountActions.ledger, { form: { id: bankAccountId, ledgerNumber: '' } })
		).toEqual({ redirect: '/bank/konten' });
		expect((await listBankAccounts(db, 'a'))[0].ledgerNumber).toBeNull();
	});
});
