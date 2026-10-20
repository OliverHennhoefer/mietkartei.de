import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { today } from '../dates';
import { effectiveFrom } from '../domain/index-rent';
import type { Database } from './db';
import { auditLog, rentCharges } from './db/schema';
import { createLease } from './leases';
import {
	addGraduatedStep,
	addIndexValue,
	approveChange,
	deleteIndexValue,
	indexLetter,
	listIndexValues,
	manualChange,
	proposeIndexChange,
	removeChange
} from './rent-adjustments';
import { listRentChanges } from './rents';
import { contextA, contextB, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;
let unitId: string;
let leaseId: string;
let foreignLeaseId: string;

// An indexed residential lease from 2024-01-01 at 600 € + 150 € + 50 €, base index
// January 2024 = 118,2; the foreign lease in account b is the same.
const indexed = {
	startDate: '2024-01-01',
	rentModel: 'indexed' as const,
	indexBaseMonth: '2024-01',
	indexBaseValue: 118.2
};

const vpi2025 = { month: '2025-01', value: 121, baseYear: '2020' };
const vpi2026 = { month: '2026-01', value: 124.3, baseYear: '2020' };

beforeEach(async () => {
	db = await testDatabase();
	({ unitId } = await seedUnit(db, 'a'));
	const { unitId: foreignUnit } = await seedUnit(db, 'b');
	const tenantId = await seedTenant(db, 'a', {
		salutation: 'Frau',
		street: 'Lindenstraße 4',
		postalCode: '10115',
		city: 'Berlin'
	});
	const own = await createLease(
		db,
		contextA,
		leaseInput(unitId, { ...indexed, tenantIds: [tenantId] })
	);
	const foreign = await createLease(db, contextB, leaseInput(foreignUnit, indexed));
	if (!own.ok || !foreign.ok) throw new Error('setup failed');
	leaseId = own.id;
	foreignLeaseId = foreign.id;
});

async function seedValues(accountId = 'a') {
	const context = accountId === 'a' ? contextA : contextB;
	await addIndexValue(db, context, vpi2025);
	await addIndexValue(db, context, vpi2026);
}

async function summaries(accountId: string) {
	const rows = await db.select().from(auditLog).where(eq(auditLog.accountId, accountId));
	return rows.map((row) => `${row.action}: ${row.summary}`);
}

async function chargeOf(id: string, period: string) {
	const [row] = await db
		.select()
		.from(rentCharges)
		.where(eq(rentCharges.leaseId, id))
		.orderBy(asc(rentCharges.period))
		.then((rows) => rows.filter((row) => row.period === period));
	return row;
}

describe('VPI values', () => {
	it('adds, lists newest first, refuses a duplicate month and deletes', async () => {
		const first = await addIndexValue(db, contextA, vpi2025);
		expect(first.ok).toBe(true);
		await addIndexValue(db, contextA, vpi2026);
		expect(await addIndexValue(db, contextA, vpi2026)).toEqual({
			ok: false,
			message: 'Für Januar 2026 (Basisjahr 2020) gibt es schon einen Wert. Lösche ihn zuerst.'
		});
		expect((await listIndexValues(db, 'a')).map((row) => [row.month, row.value])).toEqual([
			['2026-01', 124.3],
			['2025-01', 121]
		]);

		expect(await deleteIndexValue(db, contextA, first.ok ? first.id : '')).toBe(true);
		expect((await listIndexValues(db, 'a')).map((row) => row.month)).toEqual(['2026-01']);
		expect(await summaries('a')).toEqual([
			'create: Mietvertrag angelegt',
			'create: VPI Januar 2025 = 121,0 (Basisjahr 2020) eingetragen',
			'create: VPI Januar 2026 = 124,3 (Basisjahr 2020) eingetragen',
			'delete: VPI Januar 2025 = 121,0 (Basisjahr 2020) gelöscht'
		]);
	});

	it('does not leak into another account', async () => {
		const own = await addIndexValue(db, contextA, vpi2026);
		expect(await listIndexValues(db, 'b')).toEqual([]);
		expect(await deleteIndexValue(db, contextB, own.ok ? own.id : '')).toBe(false);
		expect(await listIndexValues(db, 'a')).toHaveLength(1);
	});
});

describe('proposeIndexChange and approveChange', () => {
	it('stores the proposal and approves it with letter and delivery date', async () => {
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		expect(proposed?.ok).toBe(true);
		const changeId = proposed?.ok ? proposed.id : '';

		let history = await listRentChanges(db, 'a', leaseId);
		expect(history).toHaveLength(2);
		// 600,00 × 124,3 ÷ 118,2 = 630,96; prepayments unchanged; provisional date from today.
		expect(history[1]).toMatchObject({
			id: changeId,
			validFrom: effectiveFrom(today()),
			baseRent: 63096,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'indexed',
			status: 'proposed',
			indexMonth: '2026-01',
			indexValue: 124.3,
			letterText: null,
			deliveredOn: null,
			createdBy: 'user-a'
		});
		expect(await proposeIndexChange(db, contextA, leaseId)).toEqual({
			ok: false,
			message: 'Es gibt schon einen Vorschlag. Gib ihn frei oder lösche ihn.'
		});

		const approved = await approveChange(db, contextA, leaseId, changeId, {
			deliveredOn: '2026-10-15',
			validFrom: '2026-11-01'
		});
		expect(approved).toEqual({ ok: true, id: changeId });
		history = await listRentChanges(db, 'a', leaseId);
		// Residential: the date comes from the delivery, not from the input.
		expect(history[1]).toMatchObject({
			status: 'approved',
			validFrom: '2026-12-01',
			deliveredOn: '2026-10-15'
		});
		const paragraphs = history[1].letterText?.split('\n\n') ?? [];
		expect(paragraphs[0]).toBe('Sehr geehrte Frau Mustermann,');
		expect(paragraphs[2]).toContain('von 118,2 (Januar 2024) auf 124,3 (Januar 2026)');
		expect(paragraphs[2]).toContain('von 600,00 € um 30,96 € auf 630,96 €');
		expect(paragraphs[3]).toContain('ab dem 01.12.2026');

		expect(
			await approveChange(db, contextA, leaseId, changeId, {
				deliveredOn: '2026-10-15',
				validFrom: null
			})
		).toEqual({
			ok: false,
			message: 'Diese Änderung ist schon freigegeben.'
		});
		expect((await summaries('a')).slice(-2)).toEqual([
			'create: Indexanpassung der Kaltmiete auf 630,96 € vorgeschlagen',
			'approve: Indexanpassung ab 01.12.2026 auf 630,96 € Kaltmiete freigegeben'
		]);
	});

	it('lets a commercial lease choose the effective date', async () => {
		await seedValues();
		const { unitId: office } = await seedUnit(db, 'a', { name: 'Büro' });
		const lease = await createLease(
			db,
			contextA,
			leaseInput(office, { ...indexed, kind: 'commercial' })
		);
		if (!lease.ok) throw new Error('setup failed');
		const proposed = await proposeIndexChange(db, contextA, lease.id);
		const changeId = proposed?.ok ? proposed.id : '';
		await approveChange(db, contextA, lease.id, changeId, {
			deliveredOn: '2026-10-15',
			validFrom: '2026-11-01'
		});
		const [, change] = await listRentChanges(db, 'a', lease.id);
		expect(change).toMatchObject({ status: 'approved', validFrom: '2026-11-01' });
	});

	it('refuses without VPI values and names the reason', async () => {
		expect(await proposeIndexChange(db, contextA, leaseId)).toEqual({
			ok: false,
			message: 'Es sind noch keine Werte des Verbraucherpreisindex eingetragen.'
		});
		expect(await listRentChanges(db, 'a', leaseId)).toHaveLength(1);
	});

	it('does not leak into another account', async () => {
		await seedValues('b');
		expect(await proposeIndexChange(db, contextA, foreignLeaseId)).toBeUndefined();
		const proposed = await proposeIndexChange(db, contextB, foreignLeaseId);
		const changeId = proposed?.ok ? proposed.id : '';
		expect(
			await approveChange(db, contextA, foreignLeaseId, changeId, {
				deliveredOn: '2026-10-15',
				validFrom: null
			})
		).toBeUndefined();
		expect(
			await approveChange(db, contextA, leaseId, changeId, {
				deliveredOn: '2026-10-15',
				validFrom: null
			})
		).toBeUndefined();
		const [, change] = await listRentChanges(db, 'b', foreignLeaseId);
		expect(change.status).toBe('proposed');
		// Account a has no VPI values, so its own lease cannot see b's.
		expect(await proposeIndexChange(db, contextA, leaseId)).toMatchObject({ ok: false });
	});
});

describe('manualChange', () => {
	const input = {
		validFrom: '2025-01-01',
		baseRent: 62000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		reason: 'manual' as const,
		note: 'Einvernehmlich erhöht.'
	};

	it('adds an approved change, records the index on an indexed lease and re-syncs charges', async () => {
		await seedValues();
		expect(await chargeOf(leaseId, '2025-03')).toBeUndefined();
		const result = await manualChange(db, contextA, leaseId, input);
		expect(result?.ok).toBe(true);
		const [, change] = await listRentChanges(db, 'a', leaseId);
		expect(change).toMatchObject({
			...input,
			status: 'approved',
			indexMonth: '2026-01',
			indexValue: 124.3,
			createdBy: 'user-a'
		});
		// The backdated change reaches the ledger at once: 620 + 150 + 50.
		expect(await chargeOf(leaseId, '2025-03')).toMatchObject({ baseRent: 62000, amount: 82000 });
		expect((await summaries('a')).at(-1)).toBe('update: Miete ab 01.01.2025 auf 820,00 € geändert');
	});

	it('records no index when only the prepayments change or after a statement', async () => {
		await seedValues();
		await manualChange(db, contextA, leaseId, {
			...input,
			baseRent: 60000,
			operatingCostPrepayment: 17000
		});
		await manualChange(db, contextA, leaseId, {
			...input,
			validFrom: '2025-06-01',
			baseRent: 70000,
			reason: 'statement'
		});
		const [, prepayment, statement] = await listRentChanges(db, 'a', leaseId);
		expect(prepayment).toMatchObject({ indexMonth: null, indexValue: null });
		expect(statement).toMatchObject({ indexMonth: null, reason: 'statement' });
		expect((await summaries('a')).at(-1)).toBe(
			'update: Vorauszahlungen ab 01.06.2025 nach Abrechnung angepasst, Gesamtmiete 900,00 €'
		);
	});

	it('refuses a second change on the same day and a foreign lease', async () => {
		expect(
			await manualChange(db, contextA, leaseId, { ...input, validFrom: '2024-01-01' })
		).toEqual({
			ok: false,
			message: 'Am 01.01.2024 gibt es schon eine Mietänderung.'
		});
		expect(await manualChange(db, contextA, foreignLeaseId, input)).toBeUndefined();
		expect(await listRentChanges(db, 'b', foreignLeaseId)).toHaveLength(1);
	});
});

describe('addGraduatedStep', () => {
	let graduatedId: string;

	beforeEach(async () => {
		const lease = await createLease(
			db,
			contextA,
			leaseInput(unitId, { startDate: '2025-01-01', rentModel: 'graduated' })
		);
		if (!lease.ok) throw new Error('setup failed');
		graduatedId = lease.id;
	});

	it('needs a year between steps on a residential lease and keeps the prepayments', async () => {
		expect(
			await addGraduatedStep(db, contextA, graduatedId, {
				validFrom: '2025-12-01',
				baseRent: 62000
			})
		).toEqual({
			ok: false,
			message:
				'Zwischen zwei Staffeln muss mindestens ein Jahr liegen (§ 557a Abs. 2 BGB); die nächste Staffel kann frühestens am 01.01.2026 beginnen.'
		});
		const step = await addGraduatedStep(db, contextA, graduatedId, {
			validFrom: '2026-01-01',
			baseRent: 62000
		});
		expect(step?.ok).toBe(true);
		const [, change] = await listRentChanges(db, 'a', graduatedId);
		expect(change).toMatchObject({
			validFrom: '2026-01-01',
			baseRent: 62000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'graduated',
			status: 'approved'
		});
		expect(await chargeOf(graduatedId, '2026-02')).toMatchObject({ amount: 82000 });
		expect((await summaries('a')).at(-1)).toBe('update: Staffel ab 01.01.2026: Kaltmiete 620,00 €');
	});

	it('refuses a lease without Staffelmiete and a foreign lease', async () => {
		expect(
			await addGraduatedStep(db, contextA, leaseId, { validFrom: '2026-01-01', baseRent: 62000 })
		).toEqual({
			ok: false,
			message: 'Dieser Mietvertrag hat keine Staffelmiete.'
		});
		expect(
			await addGraduatedStep(db, contextA, foreignLeaseId, {
				validFrom: '2026-01-01',
				baseRent: 62000
			})
		).toBeUndefined();
	});
});

describe('removeChange', () => {
	it('deletes proposals and unreferenced changes, never the initial one', async () => {
		// The manual change comes first, before any VPI value, so it records no index.
		const manual = await manualChange(db, contextA, leaseId, {
			validFrom: '2025-01-01',
			baseRent: 62000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			note: null
		});
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		const manualId = manual?.ok ? manual.id : '';
		const proposedId = proposed?.ok ? proposed.id : '';
		const [initial] = await listRentChanges(db, 'a', leaseId);

		expect(await removeChange(db, contextA, leaseId, initial.id)).toEqual({
			ok: false,
			message: 'Die Miete bei Vertragsbeginn gehört zum Mietvertrag und wird dort geändert.'
		});
		expect(await removeChange(db, contextA, leaseId, proposedId)).toEqual({ ok: true });
		expect(await chargeOf(leaseId, '2025-03')).toMatchObject({ baseRent: 62000 });
		expect(await removeChange(db, contextA, leaseId, manualId)).toEqual({ ok: true });
		expect((await listRentChanges(db, 'a', leaseId)).map((change) => change.reason)).toEqual([
			'initial'
		]);
		// The charges follow the history back to the initial rent.
		expect(await chargeOf(leaseId, '2025-03')).toMatchObject({ baseRent: 60000 });
	});

	it('keeps a change a later index change builds on', async () => {
		const manual = await manualChange(db, contextA, leaseId, {
			validFrom: '2025-01-01',
			baseRent: 62000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			note: null
		});
		const manualId = manual?.ok ? manual.id : '';
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		const proposedId = proposed?.ok ? proposed.id : '';
		await approveChange(db, contextA, leaseId, proposedId, {
			deliveredOn: '2026-10-15',
			validFrom: null
		});
		const result = await removeChange(db, contextA, leaseId, manualId);
		expect(result?.ok).toBe(false);
		if (result && !result.ok)
			expect(result.message).toContain('spätere Index- oder Staffeländerungen');
		expect(await removeChange(db, contextA, leaseId, proposedId)).toEqual({ ok: true });
		expect(await removeChange(db, contextA, leaseId, manualId)).toEqual({ ok: true });
	});

	it('does not delete a change of another account or of another lease', async () => {
		await seedValues('b');
		const proposed = await proposeIndexChange(db, contextB, foreignLeaseId);
		const proposedId = proposed?.ok ? proposed.id : '';
		expect(await removeChange(db, contextA, foreignLeaseId, proposedId)).toBeUndefined();
		expect(await removeChange(db, contextA, leaseId, proposedId)).toBeUndefined();
		expect(await removeChange(db, contextB, leaseId, proposedId)).toBeUndefined();
		expect(await listRentChanges(db, 'b', foreignLeaseId)).toHaveLength(2);
	});
});

describe('indexLetter', () => {
	it('builds the letter of an approved change with sender, recipient and table', async () => {
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		const changeId = proposed?.ok ? proposed.id : '';
		// No letter before the approval.
		expect(await indexLetter(db, 'a', leaseId, changeId)).toBeUndefined();
		await approveChange(db, contextA, leaseId, changeId, {
			deliveredOn: '2026-10-15',
			validFrom: null
		});

		const result = await indexLetter(db, 'a', leaseId, changeId);
		expect(result?.filename).toBe('Mieterhöhung Mustermann 01.12.2026.pdf');
		expect(result?.landlord.complete).toBe(false);
		const letter = result!.letter;
		expect(letter.sender).toEqual(['Konto A']);
		expect(letter.recipient).toEqual(['Frau Erika Mustermann', 'Lindenstraße 4', '10115 Berlin']);
		expect(letter.date).toBe('15.10.2026');
		expect(letter.subject).toBe('Mieterhöhung nach § 557b BGB');
		expect(letter.paragraphs).toHaveLength(4);
		expect(letter.tables?.[0].rows).toEqual([
			['Verbraucherpreisindex', '118,2 (Januar 2024)', '124,3 (Januar 2026)'],
			['Kaltmiete', '600,00 €', '630,96 €'],
			['Gesamtmiete', '800,00 €', '830,96 €']
		]);
		expect(letter.closing).toEqual(['Mit freundlichen Grüßen', '', 'Konto A']);
	});

	it('does not leak into another account', async () => {
		await seedValues('b');
		const proposed = await proposeIndexChange(db, contextB, foreignLeaseId);
		const changeId = proposed?.ok ? proposed.id : '';
		await approveChange(db, contextB, foreignLeaseId, changeId, {
			deliveredOn: '2026-10-15',
			validFrom: null
		});
		expect(await indexLetter(db, 'b', foreignLeaseId, changeId)).toBeDefined();
		expect(await indexLetter(db, 'a', foreignLeaseId, changeId)).toBeUndefined();
		expect(await indexLetter(db, 'a', leaseId, changeId)).toBeUndefined();
	});
});
