import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMonthsToMonth, firstOfMonth, monthOf, today } from '../dates';
import { effectiveFrom } from '../domain/index-rent';
import type { Database } from './db';
import { auditLog, consumerPriceIndex, rentCharges } from './db/schema';
import { createLease, getLease, leaseInputOf, updateLease } from './leases';
import { ensureCharges } from './ledger';
import {
	addGraduatedStep,
	approveChange,
	indexLetter,
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

/** The VPI table is shared by all accounts. */
async function seedValues() {
	await db.insert(consumerPriceIndex).values([vpi2025, vpi2026]);
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
			indexBaseYear: '2020',
			letterText: null,
			letterTable: null,
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
		expect(paragraphs[0]).toBe('Guten Tag Frau Mustermann,');
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

	it('refuses to approve a proposal whose basis changed since it was made', async () => {
		// A commercial lease approves at once. After the proposal of 630,96 €, a manual change to
		// 650,00 € takes effect before the proposal would: 630,96 € would now be a decrease.
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
		const nextMonth = firstOfMonth(addMonthsToMonth(monthOf(today()), 1));
		await manualChange(db, contextA, lease.id, {
			validFrom: nextMonth,
			baseRent: 65000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			note: null
		});
		const validFrom = effectiveFrom(today());
		expect(
			await approveChange(db, contextA, lease.id, changeId, { deliveredOn: today(), validFrom })
		).toEqual({
			ok: false,
			message: `Die Kaltmiete oder der Bezugsindex zum ${validFrom.split('-').reverse().join('.')} hat sich seit dem Vorschlag geändert. Lösche den Vorschlag und lass ihn neu berechnen.`
		});
		const changes = await listRentChanges(db, 'a', lease.id);
		expect(changes.find((change) => change.id === changeId)?.status).toBe('proposed');
	});

	it('refuses VPI values of another base year than the lease reference', async () => {
		// The lease's reference January 2024 = 118,2 is on base 2020; the table only has a value
		// on base 2025, which cannot be divided by it.
		await db
			.insert(consumerPriceIndex)
			.values({ month: '2026-01', value: 104.1, baseYear: '2025' });
		expect(await proposeIndexChange(db, contextA, leaseId)).toEqual({
			ok: false,
			message:
				'Der Bezugsindex beruht auf dem Basisjahr 2020, die VPI-Werte auf dem Basisjahr 2025. ' +
				'Trage den Bezugsindex im Mietvertrag auf das Basisjahr 2025 umgerechnet ein.'
		});
		// With the reference on base 2025 the proposal is made and records the base year.
		const lease = await getLease(db, 'a', leaseId);
		await updateLease(db, contextA, leaseId, {
			...leaseInputOf(lease!),
			indexBaseValue: 100.2,
			indexBaseYear: '2025'
		});
		expect((await proposeIndexChange(db, contextA, leaseId))?.ok).toBe(true);
		const [, proposal] = await listRentChanges(db, 'a', leaseId);
		expect(proposal).toMatchObject({ indexValue: 104.1, indexBaseYear: '2025' });
	});

	it('refuses without VPI values and names the reason', async () => {
		expect(await proposeIndexChange(db, contextA, leaseId)).toEqual({
			ok: false,
			message: 'Es liegen noch keine Werte des Verbraucherpreisindex vor.'
		});
		expect(await listRentChanges(db, 'a', leaseId)).toHaveLength(1);
	});

	it('does not leak into another account', async () => {
		await seedValues();
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
	});
});

describe('approveChange within the waiting period', () => {
	it('refuses a new rent before it stayed unchanged for a year', async () => {
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		if (!proposed?.ok) throw new Error('no proposal');
		// The Kaltmiete changed by agreement on 1 June 2026.
		await manualChange(db, contextA, leaseId, {
			validFrom: '2026-06-01',
			baseRent: 61000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			reason: 'manual',
			note: null
		});
		expect(
			await approveChange(db, contextA, leaseId, proposed.id, {
				deliveredOn: '2026-10-15',
				validFrom: null
			})
		).toEqual({
			ok: false,
			message:
				'Die Miete muss mindestens ein Jahr unverändert bleiben (§ 557b Abs. 2 BGB); die neue Miete kann frühestens am 01.06.2027 gelten.'
		});
		expect(
			await approveChange(db, contextA, leaseId, 'missing', {
				deliveredOn: '2026-10-15',
				validFrom: null
			})
		).toBeUndefined();
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
		// A § 560 change changes only the prepayments: a different Kaltmiete is refused.
		expect(
			await manualChange(db, contextA, leaseId, {
				...input,
				validFrom: '2025-06-01',
				baseRent: 70000,
				operatingCostPrepayment: 23000,
				reason: 'statement'
			})
		).toEqual({
			ok: false,
			message:
				'Eine Anpassung nach Abrechnung (§ 560 BGB) ändert nur die Vorauszahlungen. Am 01.06.2025 gilt eine Kaltmiete von 600,00\u00a0€; trage sie so ein oder wähle als Grund „Änderung“.'
		});
		await manualChange(db, contextA, leaseId, {
			...input,
			validFrom: '2025-06-01',
			baseRent: 60000,
			operatingCostPrepayment: 25000,
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

	it('refuses a change before the lease began', async () => {
		expect(
			await manualChange(db, contextA, leaseId, { ...input, validFrom: '2023-12-01' })
		).toEqual({
			ok: false,
			message: 'Eine Mietänderung kann frühestens zum Vertragsbeginn am 01.01.2024 gelten.'
		});
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

	it('lets a commercial lease step without a year between, but not before it began', async () => {
		const lease = await createLease(
			db,
			contextA,
			leaseInput(unitId, { startDate: '2025-01-01', rentModel: 'graduated', kind: 'commercial' })
		);
		if (!lease.ok) throw new Error('setup failed');
		expect(
			await addGraduatedStep(db, contextA, lease.id, { validFrom: '2024-12-01', baseRent: 62000 })
		).toEqual({
			ok: false,
			message: 'Eine Staffel kann frühestens zum Vertragsbeginn am 01.01.2025 beginnen.'
		});
		expect(
			await addGraduatedStep(db, contextA, lease.id, { validFrom: '2025-04-01', baseRent: 62000 })
		).toMatchObject({ ok: true });
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
			message:
				'Die Miete bei Vertragsbeginn gehört zum Mietvertrag; du änderst sie unter „Bearbeiten“ in der Übersicht.'
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
		await seedValues();
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

	it('keeps the approved figures when the history is corrected later', async () => {
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		const changeId = proposed?.ok ? proposed.id : '';
		await approveChange(db, contextA, leaseId, changeId, {
			deliveredOn: '2026-10-15',
			validFrom: null
		});
		const before = (await indexLetter(db, 'a', leaseId, changeId))!.letter;
		// The initial rent and the index base are corrected after the letter went out.
		const lease = await getLease(db, 'a', leaseId);
		const updated = await updateLease(db, contextA, leaseId, {
			...leaseInputOf(lease!),
			baseRent: 59000,
			indexBaseValue: 117
		});
		expect(updated.ok).toBe(true);
		const after = (await indexLetter(db, 'a', leaseId, changeId))!.letter;
		expect(after.paragraphs).toEqual(before.paragraphs);
		expect(after.tables?.[0].rows).toEqual([
			['Verbraucherpreisindex', '118,2 (Januar 2024)', '124,3 (Januar 2026)'],
			['Kaltmiete', '600,00 €', '630,96 €'],
			['Gesamtmiete', '800,00 €', '830,96 €']
		]);
	});

	it('does not leak into another account', async () => {
		await seedValues();
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

describe('later rows follow a change of a field', () => {
	// A graduated lease from 2025-01-01 at 600 € + 150 € + 50 €.
	let graduatedId: string;
	const amountsOf = async (id: string) =>
		(await listRentChanges(db, 'a', id)).map((change) => [
			change.validFrom,
			change.reason,
			change.baseRent,
			change.operatingCostPrepayment,
			change.heatingCostPrepayment
		]);

	beforeEach(async () => {
		const lease = await createLease(
			db,
			contextA,
			leaseInput(unitId, { startDate: '2025-01-01', rentModel: 'graduated' })
		);
		if (!lease.ok) throw new Error('setup failed');
		graduatedId = lease.id;
	});

	it('keeps a § 560 prepayment change after Staffel steps entered up front', async () => {
		await addGraduatedStep(db, contextA, graduatedId, { validFrom: '2027-01-01', baseRent: 62000 });
		await addGraduatedStep(db, contextA, graduatedId, { validFrom: '2028-01-01', baseRent: 64000 });
		const result = await manualChange(db, contextA, graduatedId, {
			validFrom: '2026-06-01',
			baseRent: 60000,
			operatingCostPrepayment: 20000,
			heatingCostPrepayment: 5000,
			reason: 'statement',
			note: null
		});
		expect(result?.ok).toBe(true);
		// Both steps take the new 200 € and keep their own Kaltmiete.
		expect(await amountsOf(graduatedId)).toEqual([
			['2025-01-01', 'initial', 60000, 15000, 5000],
			['2026-06-01', 'statement', 60000, 20000, 5000],
			['2027-01-01', 'graduated', 62000, 20000, 5000],
			['2028-01-01', 'graduated', 64000, 20000, 5000]
		]);
		// February 2027: 620 + 200 + 50 = 870 €, not 820 €.
		await ensureCharges(db, 'a', [graduatedId], '2027-02');
		expect(await chargeOf(graduatedId, '2027-02')).toMatchObject({
			baseRent: 62000,
			operatingCostPrepayment: 20000,
			amount: 87000
		});
		expect((await summaries('a')).at(-1)).toBe(
			'update: Vorauszahlungen ab 01.06.2026 nach Abrechnung angepasst, Gesamtmiete 850,00 € (gilt auch für 2 spätere Mietänderungen)'
		);
	});

	it('refuses a § 560 change that would undo a Staffel step between today and its date', async () => {
		await addGraduatedStep(db, contextA, graduatedId, { validFrom: '2026-01-01', baseRent: 65000 });
		// Today's rent before the step would be 600 €; from 2026-01-01 the step's 650 € apply.
		expect(
			await manualChange(db, contextA, graduatedId, {
				validFrom: '2026-03-01',
				baseRent: 60000,
				operatingCostPrepayment: 20000,
				heatingCostPrepayment: 5000,
				reason: 'statement',
				note: null
			})
		).toEqual({
			ok: false,
			message:
				'Eine Anpassung nach Abrechnung (§ 560 BGB) ändert nur die Vorauszahlungen. Am 01.03.2026 gilt eine Kaltmiete von 650,00 €; trage sie so ein oder wähle als Grund „Änderung“.'
		});
		expect(await listRentChanges(db, 'a', graduatedId)).toHaveLength(2);
	});

	it('carries a Staffel step into a later § 560 row and an approved index change into later rows', async () => {
		// A § 560 change from 2027-03-01 copied the Kaltmiete of 600 €.
		await manualChange(db, contextA, graduatedId, {
			validFrom: '2027-03-01',
			baseRent: 60000,
			operatingCostPrepayment: 20000,
			heatingCostPrepayment: 5000,
			reason: 'statement',
			note: null
		});
		// The step from 2027-01-01 to 620 € reaches it; the step keeps the prepayment of its own day.
		await addGraduatedStep(db, contextA, graduatedId, { validFrom: '2027-01-01', baseRent: 62000 });
		expect(await amountsOf(graduatedId)).toEqual([
			['2025-01-01', 'initial', 60000, 15000, 5000],
			['2027-01-01', 'graduated', 62000, 15000, 5000],
			['2027-03-01', 'statement', 62000, 20000, 5000]
		]);
		await ensureCharges(db, 'a', [graduatedId], '2027-04');
		expect(await chargeOf(graduatedId, '2027-04')).toMatchObject({ amount: 87000 });
	});

	it('takes the prepayments valid on the effective date when an index change is approved', async () => {
		await seedValues();
		const proposed = await proposeIndexChange(db, contextA, leaseId);
		const changeId = proposed?.ok ? proposed.id : '';
		// After the proposal, a § 560 change from 2026-11-01 (before the effective date) and one
		// from 2027-02-01 (after it, still carrying the old Kaltmiete of 600 €).
		await manualChange(db, contextA, leaseId, {
			validFrom: '2026-11-01',
			baseRent: 60000,
			operatingCostPrepayment: 17000,
			heatingCostPrepayment: 5000,
			reason: 'statement',
			note: null
		});
		await manualChange(db, contextA, leaseId, {
			validFrom: '2027-02-01',
			baseRent: 60000,
			operatingCostPrepayment: 19000,
			heatingCostPrepayment: 5000,
			reason: 'statement',
			note: null
		});
		await approveChange(db, contextA, leaseId, changeId, {
			deliveredOn: '2026-10-15',
			validFrom: null
		});
		// The index change from 2026-12-01 keeps the 170 € of November, and the February row
		// takes the new Kaltmiete 630,96 €.
		expect(await amountsOf(leaseId)).toEqual([
			['2024-01-01', 'initial', 60000, 15000, 5000],
			['2026-11-01', 'statement', 60000, 17000, 5000],
			['2026-12-01', 'indexed', 63096, 17000, 5000],
			['2027-02-01', 'statement', 63096, 19000, 5000]
		]);
		await ensureCharges(db, 'a', [leaseId], '2027-03');
		expect(await chargeOf(leaseId, '2027-03')).toMatchObject({ amount: 63096 + 19000 + 5000 });
	});

	it('lets later rows fall back when the change they inherited from is deleted', async () => {
		const first = await manualChange(db, contextA, graduatedId, {
			validFrom: '2026-06-01',
			baseRent: 60000,
			operatingCostPrepayment: 20000,
			heatingCostPrepayment: 5000,
			reason: 'statement',
			note: null
		});
		// A later manual change of the heating prepayment only: it inherited the 200 €.
		await manualChange(db, contextA, graduatedId, {
			validFrom: '2026-09-01',
			baseRent: 60000,
			operatingCostPrepayment: 20000,
			heatingCostPrepayment: 6000,
			reason: 'manual',
			note: null
		});
		expect(await removeChange(db, contextA, graduatedId, first?.ok ? first.id : '')).toEqual({
			ok: true
		});
		expect(await amountsOf(graduatedId)).toEqual([
			['2025-01-01', 'initial', 60000, 15000, 5000],
			['2026-09-01', 'manual', 60000, 15000, 6000]
		]);
		expect((await summaries('a')).at(-1)).toBe(
			'update: Mietänderung ab 01.06.2026 entfernt (gilt auch für 1 spätere Mietänderung)'
		);
	});
});
