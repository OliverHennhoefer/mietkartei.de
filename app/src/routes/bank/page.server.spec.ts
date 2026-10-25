import { beforeEach, describe, expect, it } from 'vitest';
import { parseBankFile } from '#lib/domain/bank-matching.ts';
import { createBankAccount, listBankAccounts } from '#lib/server/bank/accounts.ts';
import { commitImport } from '#lib/server/bank/imports.ts';
import { listRules } from '#lib/server/bank/rules.ts';
import { listTransactions } from '#lib/server/bank/transactions.ts';
import type { Database } from '#lib/server/db/index.ts';
import { users } from '#lib/server/db/schema.ts';
import {
	contextA,
	contextB,
	managerA,
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions as importActions, load as loadImport } from './import/+page.server';
import { actions as accountActions, load as loadAccounts } from './konten/+page.server';
import { actions as ruleActions, load as loadRules } from './regeln/+page.server';
import { actions, load } from './+page.server';

// The bank pages: Umsätze with their assignment, the CSV import in two steps, Bankverbindungen
// (owners only) and Zuordnungsregeln.

// Müller pays 850 € on 1 October; the janitor is paid 120,50 € on 2 October.
const sparkasse = [
	'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
	'DE02120300000000202051;01.10.26;01.10.26;GUTSCHR. UEBERWEISUNG;Miete Oktober;;;;;;;Max Müller;DE12500105175407324931;INGDDEFFXXX;850,00;EUR;Umsatz gebucht',
	'DE02120300000000202051;02.10.26;02.10.26;ONLINE-UEBERWEISUNG;Hausmeister September;;;;;;;Hausmeister GmbH;DE89370400440532013000;COBADEFFXXX;-120,50;EUR;Umsatz gebucht'
].join('\n');

const konto = { name: 'Mietkonto', iban: 'DE02120300000000202051', bic: null, holder: 'Oliver' };

let db: Database;
let leaseId: string;
let foreignLeaseId: string;
let bankAccountId: string;

beforeEach(async () => {
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	const tenantId = await seedTenant(db, 'a', { firstName: 'Max', lastName: 'Müller' });
	leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
	const other = await seedUnit(db, 'b');
	foreignLeaseId = await seedLease(db, 'b', other.unitId);
	const created = await createBankAccount(db, contextA, konto);
	if (!created.ok) throw new Error('setup failed');
	bankAccountId = created.id;
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

async function importFile(accountId = bankAccountId, context = contextA) {
	await commitImport(db, context, accountId, 'umsatz.csv', parseBankFile(sparkasse)!.results);
	const rows = (await listTransactions(db, context.accountId, { status: 'unmatched' })).rows;
	return {
		rent: rows.find((row) => row.amount > 0)!,
		janitor: rows.find((row) => row.amount < 0)!
	};
}

describe('bank', () => {
	it('books the janitor as an expense and shows it on the row', async () => {
		const { janitor } = await importFile();
		expect(
			await run(actions.expense, {
				form: { id: janitor.id, category: 'nonsense', scope: '', description: 'Hausmeister' }
			})
		).toMatchObject({
			fail: 400,
			data: { id: janitor.id, expenseErrors: { category: expect.any(String) } }
		});
		expect(
			await run(actions.expense, {
				form: { id: janitor.id, category: 'operating_costs', scope: '', description: 'Hausmeister' }
			})
		).toEqual({ data: { assigned: janitor.id } });
		expect(
			await run(actions.expense, {
				form: { id: janitor.id, category: 'operating_costs', scope: '', description: 'Hausmeister' }
			})
		).toMatchObject({
			fail: 400,
			data: { expenseErrors: { scope: 'Dieser Umsatz ist nicht mehr offen.' } }
		});
		// A property of another account is no scope of this one.
		const { rent } = await importFile();
		const foreign = await seedUnit(db, 'b');
		expect(
			await run(actions.expense, {
				form: {
					id: rent.id,
					category: 'operating_costs',
					scope: `property:${foreign.propertyId}`,
					description: 'Hausmeister'
				}
			})
		).toMatchObject({
			fail: 400,
			data: { expenseErrors: { scope: 'Diese Zuordnung gibt es nicht.' } }
		});
		const page = (await run(load, { url: `/bank?umsatz=${janitor.id}` })) as {
			data: { transactions: { assignments: unknown[] }[]; scopes: unknown[] };
		};
		expect(page.data.scopes).toHaveLength(1);
		expect(page.data.transactions[0].assignments).toEqual([
			expect.objectContaining({ kind: 'expense', amount: 12050, scope: 'Gesamter Bestand' })
		]);
	});

	it('lists open transactions with a suggestion by name', async () => {
		const { rent } = await importFile();
		const page = (await run(load, { url: '/bank' })) as {
			data: { transactions: { id: string; suggestion: unknown }[]; openCount: number };
		};
		expect(page.data).toMatchObject({ status: 'unmatched', openCount: 2 });
		expect(page.data.transactions.find((row) => row.id === rent.id)?.suggestion).toMatchObject({
			leaseId
		});
		expect(await run(load, { url: `/bank?umsatz=${rent.id}&status=ignored` })).toMatchObject({
			data: { status: 'all', transactionId: rent.id, transactions: [{ id: rent.id }] }
		});
		expect(await run(load, { url: '/bank?status=quatsch' })).toMatchObject({
			data: { status: 'unmatched' }
		});
		expect(await run(load, { url: '/bank?status=all' })).toMatchObject({
			data: { status: 'all', transactions: [{}, {}] }
		});
	});

	it('assigns a transaction to a lease and undoes it', async () => {
		const { rent } = await importFile();
		const assign = (form: Record<string, string>) =>
			run(actions.assign, { form: { id: rent.id, ...form } });
		expect(await assign({ leaseId: foreignLeaseId, target: 'rent' })).toMatchObject({
			fail: 400,
			data: { errors: { leaseId: 'Diesen Mietvertrag gibt es nicht.' } }
		});
		expect(await assign({ target: 'rent' })).toMatchObject({ fail: 400 });
		expect(await assign({ leaseId, target: 'rent' })).toEqual({
			data: { assigned: rent.id }
		});
		expect(await listRules(db, 'a')).toHaveLength(1);
		expect(await assign({ leaseId, target: 'rent' })).toMatchObject({
			fail: 400,
			data: { errors: { leaseId: 'Dieser Umsatz ist nicht mehr offen.' } }
		});
		const undo = () => run(actions.undo, { form: { id: rent.id } });
		expect(await undo()).toEqual({ data: { undone: rent.id } });
		expect(await undo()).toMatchObject({ fail: 400 });
	});

	it('ignores and reopens a transaction', async () => {
		const { janitor } = await importFile();
		const ignore = () => run(actions.ignore, { form: { id: janitor.id } });
		const reopen = () => run(actions.reopen, { form: { id: janitor.id } });
		expect(await reopen()).toMatchObject({ fail: 400 });
		expect(await ignore()).toEqual({ data: { ignored: janitor.id } });
		expect(await ignore()).toMatchObject({ fail: 400 });
		expect(await reopen()).toEqual({ data: { reopened: janitor.id } });
	});

	it('answers 404 for a transaction of another account', async () => {
		const foreignBank = await createBankAccount(db, contextB, { ...konto, name: 'Fremd' });
		if (!foreignBank.ok) throw new Error('setup failed');
		const { rent: foreign } = await importFile(foreignBank.id, contextB);
		const form = { id: foreign.id, leaseId, target: 'rent' };
		for (const action of ['assign', 'ignore', 'undo', 'reopen'] as const) {
			expect(await run(actions[action], { form }), action).toMatchObject({ error: 404 });
		}
		expect(
			await run(actions.expense, {
				form: { id: foreign.id, category: 'operating_costs', scope: '', description: 'x' }
			})
		).toMatchObject({ error: 404 });
	});

	it('answers 404 when the form names no transaction', async () => {
		for (const action of ['assign', 'ignore', 'undo', 'reopen'] as const) {
			expect(await run(actions[action], { form: {} }), action).toMatchObject({ error: 404 });
		}
		expect(
			await run(actions.expense, {
				form: { category: 'operating_costs', scope: '', description: 'x' }
			})
		).toMatchObject({ error: 404 });
	});
});

describe('bank/import', () => {
	const csv = () => new File([sparkasse], 'umsatz.csv', { type: 'text/csv' });

	it('previews a known format and commits it from the hidden field', async () => {
		expect(await run(loadImport)).toMatchObject({
			data: { bankAccounts: [{ id: bankAccountId }] }
		});
		const preview = (await run(importActions.preview, {
			form: { bankAccountId, file: csv() }
		})) as { data: { preview: { content: string; preset: string; counts: { new: number } } } };
		expect(preview.data.preview).toMatchObject({ preset: 'sparkasse-camt', counts: { new: 2 } });

		const form = {
			bankAccountId,
			content: preview.data.preview.content,
			preset: 'sparkasse-camt',
			fileName: 'umsatz.csv'
		};
		expect(await run(importActions.commit, { form })).toMatchObject({
			data: { result: { imported: 2 } }
		});
		// The same file again only finds duplicates.
		expect(
			await run(importActions.preview, { form: { bankAccountId, file: csv() } })
		).toMatchObject({
			data: { preview: { counts: { new: 0, duplicates: 2 } } }
		});
	});

	it('asks for the columns of an unknown format before the preview', async () => {
		const own = new File(['Datum;Wert;Text\n01.10.2026;850,00;Miete'], 'eigen.csv');
		const first = (await run(importActions.preview, { form: { bankAccountId, file: own } })) as {
			data: {
				preview: {
					preset: string;
					columns: string[];
					mappingError: string | null;
					content: string;
				};
			};
		};
		expect(first.data.preview).toMatchObject({
			preset: 'generic',
			columns: ['Datum', 'Wert', 'Text'],
			mappingError: expect.any(String)
		});
		const mapped = {
			bankAccountId,
			content: first.data.preview.content,
			preset: 'generic',
			bookingDate: 'Datum',
			amount: 'Wert',
			purpose: 'Text'
		};
		expect(await run(importActions.preview, { form: mapped })).toMatchObject({
			data: { preview: { mappingError: null, counts: { new: 1 } } }
		});
		expect(await run(importActions.commit, { form: { ...mapped, amount: '' } })).toMatchObject({
			fail: 400
		});
		expect(await run(importActions.commit, { form: mapped })).toMatchObject({
			data: { result: { imported: 1 } }
		});
	});

	it('proposes the columns of an unknown format from their names and previews right away', async () => {
		const own = new File(
			['Datum;Name;Verwendungszweck;Betrag\n01.10.2026;Erika;Miete;850,00'],
			'eigen.csv'
		);
		expect(await run(importActions.preview, { form: { bankAccountId, file: own } })).toMatchObject({
			data: {
				preview: {
					preset: 'generic',
					mapping: {
						bookingDate: 'Datum',
						amount: 'Betrag',
						counterpartName: 'Name',
						purpose: 'Verwendungszweck'
					},
					mappingError: null,
					counts: { new: 1 }
				}
			}
		});
	});

	it('imports the lines of a camt file that belong to the chosen account', async () => {
		const statement = (iban: string, amount: string, name: string) => `
    <Stmt>
      <Acct><Id><IBAN>${iban}</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="EUR">${amount}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-01</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>${name}</Nm></Dbtr></RltdPties></TxDtls></NtryDtls>
      </Ntry>
    </Stmt>`;
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>${statement(konto.iban, '850.00', 'Max Müller')}${statement('DE89370400440532013000', '99.00', 'Fremdes Konto')}
  </BkToCstmrStmt>
</Document>`;
		const file = () => new File([xml], 'auszug.xml', { type: 'application/xml' });
		const preview = (await run(importActions.preview, {
			form: { bankAccountId, file: file() }
		})) as {
			data: {
				preview: { content: string; preset: string; counts: { new: number; invalid: number } };
			};
		};
		expect(preview.data.preview.counts).toMatchObject({ new: 1, invalid: 1 });
		expect(
			await run(importActions.commit, {
				form: {
					bankAccountId,
					content: preview.data.preview.content,
					preset: preview.data.preview.preset,
					fileName: 'auszug.xml'
				}
			})
		).toMatchObject({ data: { result: { imported: 1 } } });

		const foreignBank = await createBankAccount(db, contextB, { ...konto, name: 'Fremd' });
		if (!foreignBank.ok) throw new Error('setup failed');
		expect(
			await run(importActions.preview, { form: { bankAccountId: foreignBank.id, file: file() } })
		).toMatchObject({
			fail: 400,
			data: { errors: { file: 'Diese Bankverbindung gibt es nicht.' } }
		});
	});

	it('refuses what it cannot read', async () => {
		const refusal = (form: Record<string, string | File>) => run(importActions.preview, { form });
		expect(await refusal({ bankAccountId })).toMatchObject({ fail: 400 });
		expect(await refusal({ bankAccountId, content: '%%%' })).toMatchObject({ fail: 400 });
		expect(await refusal({ bankAccountId, file: new File(['nur Text'], 'x.csv') })).toMatchObject({
			fail: 400,
			data: { errors: { file: expect.any(String) } }
		});
		const foreignBank = await createBankAccount(db, contextB, { ...konto, name: 'Fremd' });
		if (!foreignBank.ok) throw new Error('setup failed');
		expect(
			await refusal({ bankAccountId: foreignBank.id, file: new File([sparkasse], 'u.csv') })
		).toMatchObject({
			fail: 400,
			data: { errors: { file: 'Diese Bankverbindung gibt es nicht.' } }
		});
		// Committing needs the checked file from the preview, not a new upload.
		expect(
			await run(importActions.commit, {
				form: { bankAccountId, file: new File([sparkasse], 'u.csv') }
			})
		).toMatchObject({ fail: 400, data: { errors: { file: 'Bitte prüfe die Datei zuerst.' } } });
	});

	it('refuses to commit a file it cannot read or map, or into another account', async () => {
		const commit = (form: Record<string, string>) => run(importActions.commit, { form });
		const own = btoa('Datum;Wert;Text\n01.10.2026;850,00;Miete');
		expect(await commit({ content: own })).toMatchObject({ fail: 400 });
		expect(await commit({ bankAccountId, content: btoa('nur Text') })).toMatchObject({
			fail: 400,
			data: { errors: { file: expect.any(String) } }
		});
		expect(await commit({ bankAccountId, content: own })).toMatchObject({
			fail: 400,
			data: { errors: { file: 'Bitte ordne die Spalten zu.' } }
		});
		// A file without its own IBAN is only refused when the rows are booked.
		const foreignBank = await createBankAccount(db, contextB, { ...konto, name: 'Fremd' });
		if (!foreignBank.ok) throw new Error('setup failed');
		const mapped = { preset: 'generic', bookingDate: 'Datum', amount: 'Wert', purpose: 'Text' };
		expect(await commit({ bankAccountId: foreignBank.id, content: own, ...mapped })).toMatchObject({
			fail: 400,
			data: { errors: { file: 'Diese Bankverbindung gibt es nicht.' } }
		});
		expect(
			await run(importActions.preview, {
				form: { bankAccountId: foreignBank.id, content: own, ...mapped }
			})
		).toMatchObject({
			fail: 400,
			data: { errors: { file: 'Diese Bankverbindung gibt es nicht.' } }
		});
	});

	it('refuses a file of more than 10.000 lines', async () => {
		const lines = Array.from({ length: 10_001 }, (_, i) => `01.10.2026;${i},00;Zeile`);
		const content = btoa(['Datum;Wert;Text', ...lines].join('\n'));
		const form = {
			bankAccountId,
			content,
			preset: 'generic',
			bookingDate: 'Datum',
			amount: 'Wert'
		};
		for (const action of [importActions.preview, importActions.commit]) {
			expect(await run(action, { form })).toMatchObject({
				fail: 400,
				data: { errors: { file: expect.stringContaining('höchstens 10.000 Zeilen') } }
			});
		}
	});
});

describe('bank/konten', () => {
	it('is for owners only', async () => {
		expect(await run(loadAccounts, { user: managerA })).toEqual({
			data: { ownerOnly: true, bankAccounts: [] }
		});
		await db.insert(users).values({
			id: 'manager-a',
			accountId: 'a',
			email: 'm@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		for (const action of [accountActions.create, accountActions.delete]) {
			expect(
				await run(action, { user: managerA, form: { name: konto.name, iban: konto.iban } })
			).toMatchObject({ error: 403 });
		}
	});

	it('creates, refuses a duplicate IBAN and deletes an account', async () => {
		const form = { name: 'Rücklage', iban: 'DE89 3704 0044 0532 0130 00', holder: 'Oliver' };
		expect(await run(accountActions.create, { form })).toEqual({ data: { created: 'Rücklage' } });
		expect(await run(accountActions.create, { form })).toMatchObject({
			fail: 400,
			data: { errors: { iban: 'Ein Konto mit dieser IBAN gibt es schon.' } }
		});
		expect(await run(accountActions.create, { form: { ...form, iban: 'DE00' } })).toMatchObject({
			fail: 400
		});
		const created = (await listBankAccounts(db, 'a')).find((row) => row.name === 'Rücklage')!;
		expect(await run(accountActions.delete, { form: { id: created.id } })).toEqual({
			data: { deleted: true }
		});
		expect(await run(accountActions.delete, { form: { id: created.id } })).toMatchObject({
			error: 404
		});
	});

	it('keeps an account with assigned transactions', async () => {
		const { rent } = await importFile();
		await run(actions.assign, { form: { id: rent.id, leaseId, target: 'rent' } });
		expect(await run(accountActions.delete, { form: { id: bankAccountId } })).toMatchObject({
			fail: 400,
			data: { message: expect.stringContaining('zugeordnete Umsätze') }
		});
	});
});

describe('bank/regeln', () => {
	it('creates, confirms and deletes a rule', async () => {
		const form = { leaseId, field: 'counterpartName', pattern: 'Müller' };
		expect(await run(ruleActions.create, { form })).toEqual({ data: { created: true } });
		expect(
			await run(ruleActions.create, { form: { ...form, leaseId: foreignLeaseId } })
		).toMatchObject({
			fail: 400,
			data: { errors: { leaseId: 'Diesen Mietvertrag gibt es nicht.' } }
		});
		expect(await run(ruleActions.create, { form: { ...form, pattern: 'M' } })).toMatchObject({
			fail: 400
		});
		const loaded = (await run(loadRules)) as {
			data: { rules: { id: string }[]; leases: unknown[] };
		};
		expect(loaded.data.leases).toHaveLength(1);
		const [rule] = loaded.data.rules;
		expect(await run(ruleActions.confirm, { form: { id: rule.id } })).toEqual({
			data: { confirmed: true }
		});
		expect(await run(ruleActions.delete, { form: { id: rule.id } })).toEqual({
			data: { deleted: true }
		});
		expect(await run(ruleActions.confirm, { form: { id: rule.id } })).toMatchObject({ error: 404 });
		expect(await run(ruleActions.delete, { form: { id: rule.id } })).toMatchObject({ error: 404 });
	});
});
