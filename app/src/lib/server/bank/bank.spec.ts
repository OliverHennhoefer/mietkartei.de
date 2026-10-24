import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBankFile, type RowResult } from '../../domain/bank-matching';
import { auditLog, bankTransactions, depositTransactions, payments } from '../db/schema';
import type { Database } from '../db';
import { createLease, listLeases, updateLease, leaseInputOf, getLease } from '../leases';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from '../testing';
import { createBankAccount, deleteBankAccount, listBankAccounts } from './accounts';
import { commitImport, previewImport } from './imports';
import { confirmRule, createRule, deleteRule, listRules } from './rules';
import {
	assignTransaction,
	countUnmatched,
	expensePreset,
	ignoreTransaction,
	leaseByIban,
	leaseHints,
	leaseOptions,
	listAssignments,
	listTransactions,
	reopenTransaction,
	transactionLabel,
	undoAssignment
} from './transactions';

// Lets a test hold every import after its analysis (listLeases is its last read) until the next
// macrotask, so two commits of one file both analyse before either writes, as two requests do.
const slowAnalysis = vi.hoisted(() => ({ on: false }));
vi.mock('../leases', async (original) => {
	const actual = await original<typeof import('../leases')>();
	return {
		...actual,
		listLeases: async (...args: Parameters<typeof actual.listLeases>) => {
			if (slowAnalysis.on) await new Promise((resolve) => setTimeout(resolve, 0));
			return actual.listLeases(...args);
		}
	};
});

// A Sparkasse CAMT export with three lines: Müller pays 850 € twice on 1 October (two identical
// lines, occurrence 0 and 1) and the janitor is paid 120,50 € on 2 October.
const sparkasse = [
	'Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info',
	'DE02120300000000202051;01.10.26;01.10.26;GUTSCHR. UEBERWEISUNG;Miete Oktober;;;;;;;Max Müller;DE12500105175407324931;INGDDEFFXXX;850,00;EUR;Umsatz gebucht',
	'DE02120300000000202051;01.10.26;01.10.26;GUTSCHR. UEBERWEISUNG;Miete Oktober;;;;;;;Max Müller;DE12500105175407324931;INGDDEFFXXX;850,00;EUR;Umsatz gebucht',
	'DE02120300000000202051;02.10.26;02.10.26;ONLINE-UEBERWEISUNG;Hausmeister September;;;;;;;Hausmeister GmbH;DE89370400440532013000;COBADEFFXXX;-120,50;EUR;Umsatz gebucht'
].join('\n');

function rows(text: string): RowResult[] {
	const parsed = parseBankFile(text);
	if (!parsed) throw new Error('no table');
	return parsed.results;
}

const konto = { name: 'Mietkonto', iban: 'DE02120300000000202051', bic: null, holder: 'Oliver' };

let db: Database;
let leaseId: string;
let secondLeaseId: string;
let foreignLeaseId: string;
let bankAccountId: string;
let foreignBankAccountId: string;

beforeEach(async () => {
	slowAnalysis.on = false;
	db = await testDatabase();
	const { unitId } = await seedUnit(db, 'a');
	const { unitId: secondUnit } = await seedUnit(db, 'a', { name: 'Stellplatz 1' });
	const { unitId: foreignUnit } = await seedUnit(db, 'b');
	const tenantId = await seedTenant(db, 'a', { firstName: 'Max', lastName: 'Müller' });
	const own = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenantId] }));
	const second = await createLease(db, contextA, leaseInput(secondUnit, { kind: 'parking' }));
	const foreign = await createLease(db, contextB, leaseInput(foreignUnit));
	if (!own.ok || !second.ok || !foreign.ok) throw new Error('setup failed');
	leaseId = own.id;
	secondLeaseId = second.id;
	foreignLeaseId = foreign.id;
	const ownBank = await createBankAccount(db, contextA, konto);
	const foreignBank = await createBankAccount(db, contextB, { ...konto, name: 'Fremd' });
	if (!ownBank.ok || !foreignBank.ok) throw new Error('setup failed');
	bankAccountId = ownBank.id;
	foreignBankAccountId = foreignBank.id;
});

async function importSparkasse(text = sparkasse) {
	const result = await commitImport(db, contextA, bankAccountId, 'umsatz.csv', rows(text));
	if (!result) throw new Error('import failed');
	return result;
}

async function openTransactions() {
	return (await listTransactions(db, 'a', { status: 'unmatched' })).rows;
}

describe('bank accounts', () => {
	it('lists the accounts of one account with their transaction counts', async () => {
		await importSparkasse();
		const list = await listBankAccounts(db, 'a');
		expect(list.map((row) => [row.name, row.transactionCount])).toEqual([['Mietkonto', 3]]);
		expect(await listBankAccounts(db, 'b')).toMatchObject([{ name: 'Fremd', transactionCount: 0 }]);
	});

	it('refuses to delete an account with assigned transactions, deletes otherwise', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		await assignTransaction(db, contextA, incoming.id, {
			target: 'rent',
			parts: [{ leaseId, amount: 85000 }],
			remember: false
		});
		expect(await deleteBankAccount(db, contextA, bankAccountId)).toBe('in-use');
		await undoAssignment(db, contextA, incoming.id);
		expect(await deleteBankAccount(db, contextA, bankAccountId)).toBe('deleted');
		expect(await listBankAccounts(db, 'a')).toEqual([]);
		// The transactions went with it (cascade).
		expect((await listTransactions(db, 'a', { status: 'all' })).rows).toEqual([]);
	});

	it('refuses a second bank account with the same IBAN in one account', async () => {
		expect(await createBankAccount(db, contextA, { ...konto, name: 'Nochmal' })).toEqual({
			ok: false,
			reason: 'duplicate'
		});
		expect(await listBankAccounts(db, 'a')).toHaveLength(1);
	});

	it('does not leak into another account', async () => {
		expect(await deleteBankAccount(db, contextA, foreignBankAccountId)).toBe('missing');
		expect(await listBankAccounts(db, 'b')).toHaveLength(1);
	});
});

describe('import', () => {
	it('previews three new rows, imports them, and reports the file as duplicates next time', async () => {
		const preview = await previewImport(db, 'a', bankAccountId, rows(sparkasse));
		expect(preview?.counts).toEqual({ total: 3, new: 3, duplicates: 0, rules: 0, invalid: 0 });
		expect(preview?.rows.map((row) => row.status)).toEqual(['new', 'new', 'new']);

		const first = await importSparkasse();
		expect(first).toMatchObject({ imported: 3, duplicates: 0, assigned: 0, invalid: 0 });
		const stored = await db
			.select()
			.from(bankTransactions)
			.where(eq(bankTransactions.accountId, 'a'))
			.orderBy(asc(bankTransactions.bookingDate), asc(bankTransactions.occurrence));
		expect(stored.map((row) => [row.bookingDate, row.amount, row.occurrence, row.status])).toEqual([
			['2026-10-01', 85000, 0, 'unmatched'],
			['2026-10-01', 85000, 1, 'unmatched'],
			['2026-10-02', -12050, 0, 'unmatched']
		]);
		expect(stored[0].fingerprint).not.toBe(stored[1].fingerprint);
		expect(stored[0]).toMatchObject({
			counterpartName: 'Max Müller',
			counterpartIban: 'DE12500105175407324931',
			purpose: 'Miete Oktober',
			importId: first.importId
		});

		const again = await previewImport(db, 'a', bankAccountId, rows(sparkasse));
		expect(again?.counts).toEqual({ total: 3, new: 0, duplicates: 3, rules: 0, invalid: 0 });
		const second = await importSparkasse();
		expect(second).toMatchObject({ imported: 0, duplicates: 3 });
		expect(await countUnmatched(db, 'a')).toBe(3);
	});

	it('assigns incoming rule hits on import as matched payments, never outgoing amounts', async () => {
		await createRule(db, contextA, {
			leaseId,
			field: 'counterpartIban',
			pattern: 'DE12 5001 0517 5407 3249 31',
			confirmed: true
		});
		await createRule(db, contextA, {
			leaseId: secondLeaseId,
			field: 'counterpartName',
			pattern: 'Hausmeister',
			confirmed: true
		});
		const preview = await previewImport(db, 'a', bankAccountId, rows(sparkasse));
		expect(preview?.rows.map((row) => [row.status, row.leaseId])).toEqual([
			['rule', leaseId],
			['rule', leaseId],
			['new', null]
		]);
		expect(preview?.rows[0].leaseLabel).toBe('EG links · Haus');

		const result = await importSparkasse();
		expect(result).toMatchObject({ imported: 3, assigned: 2, duplicates: 0 });
		const paid = await db.select().from(payments).where(eq(payments.leaseId, leaseId));
		expect(paid.map((row) => [row.date, row.amount, row.source, row.note])).toEqual([
			['2026-10-01', 85000, 'bank', 'Miete Oktober'],
			['2026-10-01', 85000, 'bank', 'Miete Oktober']
		]);
		expect(paid.every((row) => row.bankTransactionId !== null)).toBe(true);
		expect(await countUnmatched(db, 'a')).toBe(1);
		expect(
			(await listTransactions(db, 'a', { status: 'matched' })).rows.map((row) => row.amount)
		).toEqual([85000, 85000]);
	});

	it('answers a double commit with duplicates instead of failing, and books each hit once', async () => {
		await createRule(db, contextA, {
			leaseId,
			field: 'counterpartIban',
			pattern: 'DE12500105175407324931',
			confirmed: true
		});
		// Both commits analyse the file before either writes, as two clicks on "Importieren" do.
		slowAnalysis.on = true;
		const results = await Promise.all([importSparkasse(), importSparkasse()]).finally(
			() => (slowAnalysis.on = false)
		);
		// Either commit may write first; the other finds every line already there.
		const [winner, loser] = results.sort((a, b) => (b?.imported ?? 0) - (a?.imported ?? 0));
		expect(winner).toMatchObject({ imported: 3, duplicates: 0, assigned: 2 });
		expect(loser).toMatchObject({ imported: 0, duplicates: 3, assigned: 0 });
		const paid = await db.select().from(payments).where(eq(payments.accountId, 'a'));
		expect(paid.map((row) => row.amount)).toEqual([85000, 85000]);
		expect(await db.select().from(bankTransactions)).toHaveLength(3);
	});

	it('books many rule hits with one audit line each', async () => {
		await createRule(db, contextA, {
			leaseId,
			field: 'counterpartIban',
			pattern: 'DE12500105175407324931',
			confirmed: true
		});
		// 30 transfers of 1,00 € to 30,00 €: 30 payments, more than one insert's worth of rows.
		const [header, line] = sparkasse.split('\n');
		const lines = Array.from({ length: 30 }, (_, index) =>
			line.replace('850,00', `${index + 1},00`)
		);
		const result = await importSparkasse([header, ...lines].join('\n'));
		expect(result).toMatchObject({ imported: 30, assigned: 30 });
		const paid = await db.select().from(payments).where(eq(payments.leaseId, leaseId));
		// 1 + 2 + … + 30 = 465 €.
		expect(paid.reduce((sum, row) => sum + row.amount, 0)).toBe(46500);
		const hits = await db.select().from(auditLog).where(eq(auditLog.action, 'assign'));
		expect(hits).toHaveLength(30);
		expect(hits[0].summary).toBe(
			'Zahlung 1,00\u00a0€ vom 01.10.2026 (Max Müller) per Regel zugeordnet'
		);
	});

	it('counts invalid rows and leaves them out', async () => {
		const broken = `${sparkasse}\nDE02;gestern;;;Zinsen;;;;;;;Bank;;;1,00;EUR;`;
		const preview = await previewImport(db, 'a', bankAccountId, rows(broken));
		expect(preview?.counts).toEqual({ total: 4, new: 3, duplicates: 0, rules: 0, invalid: 1 });
		expect(preview?.rows[3]).toMatchObject({
			status: 'invalid',
			reason: 'Ungültiges Datum „gestern“'
		});
		expect(await importSparkasse(broken)).toMatchObject({ imported: 3, invalid: 1, total: 4 });
	});

	it('writes one audit entry for the import', async () => {
		await importSparkasse();
		const entries = await db.select().from(auditLog).where(eq(auditLog.entity, 'bankImport'));
		expect(entries).toHaveLength(1);
		expect(entries[0].summary).toBe(
			'Kontoauszug „umsatz.csv“ importiert: 3\u00a0neue Umsätze, 0\u00a0Duplikate, 0 per Regel zugeordnet'
		);
	});

	it('does not leak into another account', async () => {
		expect(await previewImport(db, 'a', foreignBankAccountId, rows(sparkasse))).toBeUndefined();
		expect(
			await commitImport(db, contextA, foreignBankAccountId, 'x.csv', rows(sparkasse))
		).toBeUndefined();
		await importSparkasse();
		expect((await listTransactions(db, 'b', { status: 'all' })).rows).toEqual([]);
		expect(await countUnmatched(db, 'b')).toBe(0);
	});
});

describe('transactions', () => {
	it('filters by status and bank account, newest first, and knows when there are more', async () => {
		await importSparkasse();
		const open = await listTransactions(db, 'a', { status: 'unmatched', limit: 2 });
		expect(open.more).toBe(true);
		expect(open.rows.map((row) => [row.bookingDate, row.amount, row.bankAccountName])).toEqual([
			['2026-10-02', -12050, 'Mietkonto'],
			['2026-10-01', 85000, 'Mietkonto']
		]);
		expect(
			(await listTransactions(db, 'a', { status: 'all', bankAccountId: foreignBankAccountId })).rows
		).toEqual([]);
		expect((await listTransactions(db, 'a', { status: 'matched' })).rows).toEqual([]);
	});

	it('assigns a payment, remembers a rule on the IBAN, and undoes it again', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		expect(
			await assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [{ leaseId, amount: 85000 }],
				remember: true
			})
		).toBe('assigned');

		const assignments = await listAssignments(db, 'a', [incoming.id]);
		expect(assignments.get(incoming.id)).toMatchObject([{ kind: 'rent', leaseId, amount: 85000 }]);
		expect(await leaseByIban(db, 'a')).toEqual(new Map([['DE12500105175407324931', leaseId]]));
		expect(await listRules(db, 'a')).toMatchObject([
			{ leaseId, field: 'counterpartIban', pattern: 'DE12500105175407324931', confirmed: true }
		]);
		expect(await countUnmatched(db, 'a')).toBe(2);
		// Assigning twice is refused.
		expect(
			await assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [{ leaseId, amount: 85000 }],
				remember: false
			})
		).toBe('not-open');

		expect(await undoAssignment(db, contextA, incoming.id)).toBe('undone');
		expect(await db.select().from(payments).where(eq(payments.accountId, 'a'))).toEqual([]);
		expect(await countUnmatched(db, 'a')).toBe(3);
		expect(await undoAssignment(db, contextA, incoming.id)).toBe('not-matched');
		const actions = (
			await db.select().from(auditLog).where(eq(auditLog.entity, 'bankTransaction'))
		).map((entry) => entry.action);
		expect(actions).toEqual(['assign', 'undo']);
	});

	it('books a double submit once: the second of two overlapping assignments is refused', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		const input = { target: 'rent' as const, parts: [{ leaseId, amount: 85000 }], remember: true };
		// Both calls read the status 'unmatched' before either batch runs (each awaits its reads
		// first), as two requests from a double click do.
		const outcomes = await Promise.all([
			assignTransaction(db, contextA, incoming.id, input),
			assignTransaction(db, contextA, incoming.id, input)
		]);
		expect(outcomes.sort()).toEqual(['assigned', 'not-open']);
		const paid = await db.select().from(payments).where(eq(payments.accountId, 'a'));
		expect(paid.map((row) => row.amount)).toEqual([85000]);
		expect(await listRules(db, 'a')).toHaveLength(1);
		const actions = (
			await db.select().from(auditLog).where(eq(auditLog.entity, 'bankTransaction'))
		).map((entry) => entry.action);
		expect(actions).toEqual(['assign']);
	});

	it('refuses a rent and a deposit assignment of the same transaction at once', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		const outcomes = await Promise.all([
			assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [{ leaseId, amount: 85000 }],
				remember: false
			}),
			assignTransaction(db, contextA, incoming.id, {
				target: 'deposit',
				parts: [{ leaseId, amount: 85000 }],
				remember: false
			})
		]);
		expect(outcomes).toEqual(['assigned', 'not-open']);
		expect(await db.select().from(payments).where(eq(payments.accountId, 'a'))).toHaveLength(1);
		expect(await db.select().from(depositTransactions)).toEqual([]);
	});

	it('does not assign a transaction that an overlapping request ignores', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		const outcomes = await Promise.all([
			assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [{ leaseId, amount: 85000 }],
				remember: false
			}),
			ignoreTransaction(db, contextA, incoming.id)
		]);
		// The ignore reads less and so writes first; the assignment then finds it closed.
		expect(outcomes).toEqual(['not-open', 'ignored']);
		const [stored] = await db
			.select()
			.from(bankTransactions)
			.where(eq(bankTransactions.id, incoming.id));
		expect(stored.status).toBe('ignored');
		expect(await db.select().from(payments).where(eq(payments.accountId, 'a'))).toEqual([]);
	});

	it('undoes an assignment once when undo is submitted twice', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		await assignTransaction(db, contextA, incoming.id, {
			target: 'rent',
			parts: [{ leaseId, amount: 85000 }],
			remember: false
		});
		const outcomes = await Promise.all([
			undoAssignment(db, contextA, incoming.id),
			undoAssignment(db, contextA, incoming.id)
		]);
		expect(outcomes.sort()).toEqual(['not-matched', 'undone']);
		const actions = (
			await db.select().from(auditLog).where(eq(auditLog.entity, 'bankTransaction'))
		).map((entry) => entry.action);
		expect(actions).toEqual(['assign', 'undo']);
	});

	it('splits a transaction over two leases: 850 = 800 + 50', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		expect(
			await assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [
					{ leaseId, amount: 80000 },
					{ leaseId: secondLeaseId, amount: 5000 }
				],
				remember: false
			})
		).toBe('assigned');
		const paid = await db.select().from(payments).where(eq(payments.accountId, 'a'));
		expect(paid.map((row) => [row.leaseId, row.amount]).sort()).toEqual(
			[
				[leaseId, 80000],
				[secondLeaseId, 5000]
			].sort()
		);
	});

	it('books a deposit movement, received for incoming and returned for outgoing', async () => {
		await importSparkasse();
		const open = await openTransactions();
		const incoming = open.find((row) => row.amount > 0)!;
		const outgoing = open.find((row) => row.amount < 0)!;
		await assignTransaction(db, contextA, incoming.id, {
			target: 'deposit',
			parts: [{ leaseId, amount: 85000 }],
			remember: false
		});
		await assignTransaction(db, contextA, outgoing.id, {
			target: 'deposit',
			parts: [{ leaseId, amount: -12050 }],
			remember: false
		});
		const movements = await db
			.select()
			.from(depositTransactions)
			.where(eq(depositTransactions.leaseId, leaseId))
			.orderBy(asc(depositTransactions.date));
		expect(movements.map((row) => [row.date, row.amount, row.kind])).toEqual([
			['2026-10-01', 85000, 'received'],
			['2026-10-02', -12050, 'returned']
		]);
		expect(await undoAssignment(db, contextA, outgoing.id)).toBe('undone');
		expect(await db.select().from(depositTransactions)).toHaveLength(1);
	});

	it('refuses amounts that do not add up and leases of another account', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		expect(
			await assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [{ leaseId, amount: 80000 }],
				remember: false
			})
		).toBe('amount-mismatch');
		expect(
			await assignTransaction(db, contextA, incoming.id, {
				target: 'rent',
				parts: [{ leaseId: foreignLeaseId, amount: 85000 }],
				remember: false
			})
		).toBe('unknown-lease');
		expect(await countUnmatched(db, 'a')).toBe(3);
	});

	it('ignores and reopens a transaction', async () => {
		await importSparkasse();
		const [outgoing] = (await openTransactions()).filter((row) => row.amount < 0);
		expect(await ignoreTransaction(db, contextA, outgoing.id)).toBe('ignored');
		expect(await ignoreTransaction(db, contextA, outgoing.id)).toBe('not-open');
		expect((await listTransactions(db, 'a', { status: 'ignored' })).rows).toHaveLength(1);
		expect(await reopenTransaction(db, contextA, outgoing.id)).toBe('reopened');
		expect(await reopenTransaction(db, contextA, outgoing.id)).toBe('not-ignored');
		expect(await countUnmatched(db, 'a')).toBe(3);
	});

	it('does not leak into another account', async () => {
		await importSparkasse();
		const [incoming] = (await openTransactions()).filter((row) => row.amount > 0);
		expect(
			await assignTransaction(db, contextB, incoming.id, {
				target: 'rent',
				parts: [{ leaseId: foreignLeaseId, amount: 85000 }],
				remember: false
			})
		).toBe('missing');
		expect(await ignoreTransaction(db, contextB, incoming.id)).toBe('missing');
		expect(await undoAssignment(db, contextB, incoming.id)).toBe('missing');
		expect(await reopenTransaction(db, contextB, incoming.id)).toBe('missing');
		expect(await listAssignments(db, 'b', [incoming.id])).toEqual(new Map());
		expect(await leaseByIban(db, 'b')).toEqual(new Map());
	});
});

describe('rules', () => {
	it('creates, confirms and deletes rules in creation order', async () => {
		const first = await createRule(db, contextA, {
			leaseId,
			field: 'purpose',
			pattern: 'Wohnung 1',
			confirmed: false
		});
		const second = await createRule(db, contextA, {
			leaseId: secondLeaseId,
			field: 'counterpartName',
			pattern: 'Müller',
			confirmed: false
		});
		if (!first.ok || !second.ok) throw new Error('rule not created');
		expect((await listRules(db, 'a')).map((rule) => rule.id)).toEqual([first.id, second.id]);

		expect(await confirmRule(db, contextA, first.id)).toBe(true);
		expect((await listRules(db, 'a')).map((rule) => rule.confirmed)).toEqual([true, false]);
		expect(await deleteRule(db, contextA, second.id)).toBe(true);
		expect(await listRules(db, 'a')).toHaveLength(1);
	});

	it('does not leak into another account', async () => {
		expect(
			await createRule(db, contextA, {
				leaseId: foreignLeaseId,
				field: 'purpose',
				pattern: 'Miete',
				confirmed: true
			})
		).toEqual({ ok: false, reason: 'unknown-lease' });
		const foreign = await createRule(db, contextB, {
			leaseId: foreignLeaseId,
			field: 'purpose',
			pattern: 'Miete',
			confirmed: false
		});
		if (!foreign.ok) throw new Error('rule not created');
		expect(await confirmRule(db, contextA, foreign.id)).toBe(false);
		expect(await deleteRule(db, contextA, foreign.id)).toBe(false);
		expect(await listRules(db, 'a')).toEqual([]);
		expect(await listRules(db, 'b')).toHaveLength(1);
	});
});

describe('transaction helpers', () => {
	it('suggests the lease of the latest payment from an IBAN', async () => {
		await importSparkasse();
		const [first, second] = (await openTransactions()).filter((row) => row.amount > 0);
		for (const [transaction, lease] of [
			[first, leaseId],
			[second, secondLeaseId]
		] as const) {
			await assignTransaction(db, contextA, transaction.id, {
				target: 'rent',
				parts: [{ leaseId: lease, amount: 85000 }],
				remember: false
			});
		}
		expect(await leaseByIban(db, 'a')).toEqual(
			new Map([['DE12500105175407324931', secondLeaseId]])
		);
	});

	it('labels leases with their tenants and marks ended ones', async () => {
		const lease = (await getLease(db, 'a', secondLeaseId))!;
		await updateLease(db, contextA, secondLeaseId, {
			...leaseInputOf(lease),
			startDate: '2024-01-01',
			endDate: '2024-12-31'
		});
		const summaries = await listLeases(db, 'a');
		expect(leaseOptions(summaries)).toEqual(
			expect.arrayContaining([
				{ id: leaseId, label: 'EG links · Haus – Müller', active: true },
				{ id: secondLeaseId, label: 'Stellplatz 1 · Haus (beendet)', active: false }
			])
		);
		expect(leaseHints(summaries)).toEqual(
			expect.arrayContaining([{ id: leaseId, lastNames: ['Müller'], unitNames: ['EG links'] }])
		);
	});

	it('names a transaction without counterpart and finds the expense preset by IBAN or name', () => {
		expect(
			transactionLabel({ amount: -1250, bookingDate: '2026-10-02', counterpartName: '' })
		).toBe('Umsatz -12,50\u00a0€ vom 02.10.2026 (ohne Namen)');
		const preset = { category: 'other' as const, scope: '', description: 'Strom' };
		const presets = {
			byIban: new Map([['DE89370400440532013000', preset]]),
			byName: new Map([['stadtwerke', { ...preset, description: 'Wasser' }]])
		};
		expect(
			expensePreset({ counterpartIban: 'DE89370400440532013000', counterpartName: 'X' }, presets)
		).toBe(preset);
		expect(
			expensePreset({ counterpartIban: null, counterpartName: ' Stadtwerke ' }, presets)
		).toMatchObject({ description: 'Wasser' });
		expect(expensePreset({ counterpartIban: null, counterpartName: '' }, presets)).toBeUndefined();
	});
});
