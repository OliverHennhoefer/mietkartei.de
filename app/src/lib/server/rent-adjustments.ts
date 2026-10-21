import { and, desc, eq } from 'drizzle-orm';
import { formatDate, formatMonth, today, type IsoDate, type IsoMonth } from '../dates';
import {
	effectiveFrom,
	formatIndexValue,
	indexLetterRows,
	indexLetterText,
	indexSituation,
	latestIndex,
	letterFigures,
	nextGraduatedStepAllowed,
	waitingPeriodEnd,
	type HistoryChange
} from '../domain/index-rent';
import { rentOn, total, type RentAmounts } from '../domain/rents';
import { personName } from '../format';
import { formatCents } from '../money';
import { addressLines, landlordAddress, type LandlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { consumerPriceIndex, rentChanges } from './db/schema';
import { getLease, type LeaseSummary } from './leases';
import { ensureCharges } from './ledger';
import type { Letter } from './pdf';
import { laterRows, laterRowsNote } from './rent-history';
import { listRentChanges, type RentChangeRow } from './rents';

// Changes of the rent beyond the initial one: manual changes, Staffel steps, index proposals with
// their approval and letter, and the VPI table the proposals are computed from. Every write
// re-syncs the rent charges, so the ledger follows the history at once.

export type AdjustmentResult = { ok: true; id: string } | { ok: false; message: string };

function refuse(message: string): AdjustmentResult {
	return { ok: false, message };
}

// VPI (Verbraucherpreisindex)

export type IndexValueInput = { month: IsoMonth; value: number; baseYear: string };

export type IndexValueRow = typeof consumerPriceIndex.$inferSelect;

/** The account's VPI values, newest month first. */
export async function listIndexValues(db: Database, accountId: string): Promise<IndexValueRow[]> {
	return db
		.select()
		.from(consumerPriceIndex)
		.where(eq(consumerPriceIndex.accountId, accountId))
		.orderBy(desc(consumerPriceIndex.month), desc(consumerPriceIndex.baseYear));
}

function indexValueSummary(value: IndexValueInput, verb: string): string {
	return `VPI ${formatMonth(value.month)} = ${formatIndexValue(value.value)} (Basisjahr ${value.baseYear}) ${verb}`;
}

/** Adds a VPI value; a month already entered for the base year is refused. */
export async function addIndexValue(
	db: Database,
	context: AuditContext,
	input: IndexValueInput
): Promise<AdjustmentResult> {
	const [existing] = await db
		.select({ id: consumerPriceIndex.id })
		.from(consumerPriceIndex)
		.where(
			and(
				eq(consumerPriceIndex.accountId, context.accountId),
				eq(consumerPriceIndex.baseYear, input.baseYear),
				eq(consumerPriceIndex.month, input.month)
			)
		);
	if (existing) {
		return refuse(
			`Für ${formatMonth(input.month)} (Basisjahr ${input.baseYear}) gibt es schon einen Wert. Lösche ihn zuerst.`
		);
	}
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(consumerPriceIndex).values({ id, accountId: context.accountId, ...input }),
		auditEntry(db, context, 'vpi', id, 'create', indexValueSummary(input, 'eingetragen'))
	]);
	return { ok: true, id };
}

export async function deleteIndexValue(
	db: Database,
	context: AuditContext,
	id: string
): Promise<boolean> {
	const [row] = await db
		.select()
		.from(consumerPriceIndex)
		.where(and(eq(consumerPriceIndex.accountId, context.accountId), eq(consumerPriceIndex.id, id)));
	if (!row) return false;
	await runBatch(db, [
		db
			.delete(consumerPriceIndex)
			.where(
				and(eq(consumerPriceIndex.accountId, context.accountId), eq(consumerPriceIndex.id, id))
			),
		auditEntry(db, context, 'vpi', id, 'delete', indexValueSummary(row, 'gelöscht'))
	]);
	return true;
}

// Rent changes

/** One change of the lease, or undefined when it is not the lease's or not the account's. */
export async function getRentChange(
	db: Database,
	accountId: string,
	leaseId: string,
	changeId: string
): Promise<RentChangeRow | undefined> {
	const [change] = await db
		.select()
		.from(rentChanges)
		.where(
			and(
				eq(rentChanges.accountId, accountId),
				eq(rentChanges.leaseId, leaseId),
				eq(rentChanges.id, changeId)
			)
		);
	return change;
}

function hasApprovedOn(changes: readonly HistoryChange[], validFrom: IsoDate): boolean {
	return changes.some((change) => change.status === 'approved' && change.validFrom === validFrom);
}

function sameDayRefusal(validFrom: IsoDate): AdjustmentResult {
	return refuse(`Am ${formatDate(validFrom)} gibt es schon eine Mietänderung.`);
}

export type ManualChangeInput = {
	validFrom: IsoDate;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	reason: 'manual' | 'statement';
	note: string | null;
};

function amountsOf(rent: RentAmounts): RentAmounts {
	return {
		baseRent: rent.baseRent,
		operatingCostPrepayment: rent.operatingCostPrepayment,
		heatingCostPrepayment: rent.heatingCostPrepayment
	};
}

/**
 * "Änderung ab Datum": an approved change of any amount. The fields it changes against the rent
 * valid on that day are carried into later rows that inherited the old value (a Staffel step
 * entered up front keeps its own Kaltmiete but takes the new prepayments). A § 560 change
 * (reason `statement`) changes only the prepayments: a Kaltmiete different from the one valid on
 * that day is refused. On an indexed lease a change of the base rent records the latest VPI, so
 * the next index proposal starts from this rent and index. Returns undefined when the lease is
 * not in the account.
 */
export async function manualChange(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: ManualChangeInput
): Promise<AdjustmentResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	if (input.validFrom < lease.startDate) {
		return refuse(
			`Eine Mietänderung kann frühestens zum Vertragsbeginn am ${formatDate(lease.startDate)} gelten.`
		);
	}
	const changes = await listRentChanges(db, context.accountId, leaseId);
	if (hasApprovedOn(changes, input.validFrom)) return sameDayRefusal(input.validFrom);
	const before = rentOn(changes, input.validFrom);
	if (!before) return refuse('Dem Mietvertrag fehlt die Miete bei Vertragsbeginn.');
	if (input.reason === 'statement' && input.baseRent !== before.baseRent) {
		return refuse(
			`Eine Anpassung nach Abrechnung (§ 560 BGB) ändert nur die Vorauszahlungen. Am ${formatDate(input.validFrom)} gilt eine Kaltmiete von ${formatCents(before.baseRent)}; trage sie so ein oder wähle als Grund „Änderung“.`
		);
	}

	let index: { indexMonth: string; indexValue: number } | undefined;
	if (lease.rentModel === 'indexed' && input.reason === 'manual') {
		const latest = latestIndex(await listIndexValues(db, context.accountId));
		if (latest.ok && before.baseRent !== input.baseRent) {
			index = { indexMonth: latest.latest.month, indexValue: latest.latest.value };
		}
	}

	const id = crypto.randomUUID();
	const later = laterRows(
		db,
		context.accountId,
		changes,
		input.validFrom,
		amountsOf(before),
		amountsOf(input)
	);
	const summary =
		(input.reason === 'statement'
			? `Vorauszahlungen ab ${formatDate(input.validFrom)} nach Abrechnung angepasst, Gesamtmiete ${formatCents(total(input))}`
			: `Miete ab ${formatDate(input.validFrom)} auf ${formatCents(total(input))} geändert`) +
		laterRowsNote(later);
	await runBatch(db, [
		db.insert(rentChanges).values({
			id,
			accountId: context.accountId,
			leaseId,
			...input,
			...index,
			status: 'approved',
			createdBy: context.userId
		}),
		...later.statements,
		auditEntry(db, context, 'lease', leaseId, 'update', summary)
	]);
	await ensureCharges(db, context.accountId, [leaseId]);
	return { ok: true, id };
}

export type GraduatedStepInput = { validFrom: IsoDate; baseRent: number };

/**
 * A step of a graduated rent (§ 557a BGB), approved at once. The prepayments stay as they are on
 * the day of the step; later rows that carried the old Kaltmiete take the new one. Residential
 * leases need a year between steps.
 */
export async function addGraduatedStep(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: GraduatedStepInput
): Promise<AdjustmentResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	if (lease.rentModel !== 'graduated') return refuse('Dieser Mietvertrag hat keine Staffelmiete.');
	const changes = await listRentChanges(db, context.accountId, leaseId);
	if (hasApprovedOn(changes, input.validFrom)) return sameDayRefusal(input.validFrom);
	const earliest = nextGraduatedStepAllowed(changes);
	if (lease.kind === 'residential' && earliest && input.validFrom < earliest) {
		return refuse(
			`Zwischen zwei Staffeln muss mindestens ein Jahr liegen (§ 557a Abs. 2 BGB); die nächste Staffel kann frühestens am ${formatDate(earliest)} beginnen.`
		);
	}
	if (input.validFrom < lease.startDate) {
		return refuse(
			`Eine Staffel kann frühestens zum Vertragsbeginn am ${formatDate(lease.startDate)} beginnen.`
		);
	}
	const before = rentOn(changes, input.validFrom);
	if (!before) return refuse('Dem Mietvertrag fehlt die Miete bei Vertragsbeginn.');
	const after = { ...amountsOf(before), baseRent: input.baseRent };
	const id = crypto.randomUUID();
	const later = laterRows(
		db,
		context.accountId,
		changes,
		input.validFrom,
		amountsOf(before),
		after
	);
	await runBatch(db, [
		db.insert(rentChanges).values({
			id,
			accountId: context.accountId,
			leaseId,
			validFrom: input.validFrom,
			...after,
			reason: 'graduated',
			status: 'approved',
			note: null,
			createdBy: context.userId
		}),
		...later.statements,
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Staffel ab ${formatDate(input.validFrom)}: Kaltmiete ${formatCents(input.baseRent)}` +
				laterRowsNote(later)
		)
	]);
	await ensureCharges(db, context.accountId, [leaseId]);
	return { ok: true, id };
}

/**
 * Stores the index proposal of today as a proposed change: the new base rent against the latest
 * VPI, the prepayments unchanged, valid provisionally from effectiveFrom(today). Refuses with the
 * sentence of indexSituation when no proposal is possible.
 */
export async function proposeIndexChange(
	db: Database,
	context: AuditContext,
	leaseId: string
): Promise<AdjustmentResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const [changes, values] = await Promise.all([
		listRentChanges(db, context.accountId, leaseId),
		listIndexValues(db, context.accountId)
	]);
	const day = today();
	const situation = indexSituation(lease, changes, values, day);
	if (situation.refusal) return refuse(situation.refusal);
	const proposal = situation.proposal!;
	const current = rentOn(changes, day) ?? rentOn(changes, '9999-12-31')!;

	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(rentChanges).values({
			id,
			accountId: context.accountId,
			leaseId,
			validFrom: situation.provisionalFrom,
			baseRent: proposal.newBaseRent,
			operatingCostPrepayment: current.operatingCostPrepayment,
			heatingCostPrepayment: current.heatingCostPrepayment,
			reason: 'indexed',
			status: 'proposed',
			note: null,
			indexMonth: proposal.latest.month,
			indexValue: proposal.latest.value,
			createdBy: context.userId
		}),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'create',
			`Indexanpassung der Kaltmiete auf ${formatCents(proposal.newBaseRent)} vorgeschlagen`
		)
	]);
	await ensureCharges(db, context.accountId, [leaseId]);
	return { ok: true, id };
}

export type ApprovalInput = {
	deliveredOn: IsoDate;
	/** Commercial and parking leases may choose the date; residential ones get effectiveFrom(). */
	validFrom: IsoDate | null;
};

/**
 * Approves a proposed index change: sets the delivery date and the effective date, writes the
 * letter text and makes the change part of the rent history. Returns undefined when the lease or
 * the change is not in the account.
 */
export async function approveChange(
	db: Database,
	context: AuditContext,
	leaseId: string,
	changeId: string,
	input: ApprovalInput
): Promise<AdjustmentResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const change = await getRentChange(db, context.accountId, leaseId, changeId);
	if (!change) return undefined;
	if (change.status !== 'proposed') return refuse('Diese Änderung ist schon freigegeben.');

	const validFrom =
		lease.kind === 'residential' || !input.validFrom
			? effectiveFrom(input.deliveredOn)
			: input.validFrom;
	const changes = await listRentChanges(db, context.accountId, leaseId);
	if (hasApprovedOn(changes, validFrom)) return sameDayRefusal(validFrom);
	const waitingUntil = lease.kind === 'residential' ? waitingPeriodEnd(changes) : undefined;
	if (waitingUntil && validFrom < waitingUntil) {
		return refuse(
			`Die Miete muss mindestens ein Jahr unverändert bleiben (§ 557b Abs. 2 BGB); die neue Miete kann frühestens am ${formatDate(waitingUntil)} gelten.`
		);
	}

	const others = changes.filter((other) => other.id !== change.id);
	// The prepayments were copied when the change was proposed; take the ones valid on the
	// effective date, so a § 560 change in between is kept.
	const before = rentOn(others, validFrom);
	if (!before) return refuse('Dem Mietvertrag fehlt die Miete bei Vertragsbeginn.');
	const amounts = { ...amountsOf(before), baseRent: change.baseRent };
	const approved: HistoryChange = { ...change, ...amounts, validFrom, status: 'approved' };
	const later = laterRows(db, context.accountId, others, validFrom, amountsOf(before), amounts);
	const latest = latestIndex(await listIndexValues(db, context.accountId));
	const baseYear = latest.ok ? latest.latest.baseYear : '2020';
	const figures = letterFigures([...others, approved], lease, approved, baseYear);
	if (!figures)
		return refuse('Für dieses Schreiben fehlen der Bezugsindex oder die bisherige Miete.');
	const letterText = indexLetterText({
		unitName: lease.unit.name,
		tenants: lease.tenants,
		figures
	});

	await runBatch(db, [
		db
			.update(rentChanges)
			.set({
				status: 'approved',
				validFrom,
				...amounts,
				deliveredOn: input.deliveredOn,
				letterText
			})
			.where(and(eq(rentChanges.accountId, context.accountId), eq(rentChanges.id, changeId))),
		...later.statements,
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'approve',
			`Indexanpassung ab ${formatDate(validFrom)} auf ${formatCents(change.baseRent)} Kaltmiete freigegeben` +
				laterRowsNote(later)
		)
	]);
	await ensureCharges(db, context.accountId, [leaseId]);
	return { ok: true, id: changeId };
}

/**
 * Deletes a change of the lease and re-syncs the charges. A proposal can always go; an approved
 * change only while no later index or Staffel change builds on it, and never the initial one.
 * Returns undefined when the change is not the lease's.
 */
export async function removeChange(
	db: Database,
	context: AuditContext,
	leaseId: string,
	changeId: string
): Promise<{ ok: true } | { ok: false; message: string } | undefined> {
	const change = await getRentChange(db, context.accountId, leaseId, changeId);
	if (!change) return undefined;
	if (change.reason === 'initial') {
		return refuse(
			'Die Miete bei Vertragsbeginn gehört zum Mietvertrag; du änderst sie unter „Bearbeiten“ in der Übersicht.'
		);
	}
	const changes = await listRentChanges(db, context.accountId, leaseId);
	if (change.status === 'approved') {
		const referenced = changes.some(
			(other) =>
				other.status === 'approved' &&
				other.validFrom > change.validFrom &&
				(other.reason === 'indexed' || other.reason === 'graduated')
		);
		if (referenced) {
			return refuse(
				'Diese Änderung kann nicht gelöscht werden, weil spätere Index- oder Staffeländerungen auf ihr aufbauen. Lösche zuerst die späteren Änderungen.'
			);
		}
	}
	// The later rows that inherited this change's values fall back to the rent before it.
	const others = changes.filter((other) => other.id !== change.id);
	const previous = change.status === 'approved' ? rentOn(others, change.validFrom) : undefined;
	const later = previous
		? laterRows(
				db,
				context.accountId,
				others,
				change.validFrom,
				amountsOf(change),
				amountsOf(previous)
			)
		: { statements: [], count: 0 };
	await runBatch(db, [
		db
			.delete(rentChanges)
			.where(and(eq(rentChanges.accountId, context.accountId), eq(rentChanges.id, changeId))),
		...later.statements,
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Mietänderung ab ${formatDate(change.validFrom)} entfernt` + laterRowsNote(later)
		)
	]);
	await ensureCharges(db, context.accountId, [leaseId]);
	return { ok: true };
}

// The letter

/** The tenants' address for the window of the letter: the first tenant with one, else the unit's. */
function recipientLines(lease: LeaseSummary): string[] {
	const lines = lease.tenants.map((tenant) =>
		[tenant.salutation, personName(tenant)].filter(Boolean).join(' ')
	);
	const withAddress = lease.tenants.find((tenant) => tenant.street && tenant.city);
	const street = withAddress?.street ?? lease.property.street;
	const postalCode = withAddress?.postalCode ?? lease.property.postalCode;
	const city = withAddress?.city ?? lease.property.city;
	if (street) lines.push(street);
	lines.push([postalCode, city].filter(Boolean).join(' '));
	return lines;
}

/**
 * The index letter of an approved change as a Letter for renderLetter; undefined when the change
 * is not the lease's or carries no letter text.
 */
export async function indexLetter(
	db: Database,
	accountId: string,
	leaseId: string,
	changeId: string
): Promise<{ letter: Letter; filename: string; landlord: LandlordAddress } | undefined> {
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	const change = await getRentChange(db, accountId, leaseId, changeId);
	if (!change || !change.letterText) return undefined;
	const [changes, values, landlord] = await Promise.all([
		listRentChanges(db, accountId, leaseId),
		listIndexValues(db, accountId),
		landlordAddress(db, accountId)
	]);
	const latest = latestIndex(values);
	const figures = letterFigures(
		changes,
		lease,
		change,
		latest.ok ? latest.latest.baseYear : '2020'
	);

	const date = formatDate(change.deliveredOn ?? today());
	const letter: Letter = {
		sender: addressLines(landlord),
		recipient: recipientLines(lease),
		date: landlord.city ? `${landlord.city}, ${date}` : date,
		subject: 'Mieterhöhung nach § 557b BGB',
		paragraphs: change.letterText.split('\n\n'),
		tables: figures
			? [
					{
						columns: [
							{ label: '' },
							{ label: 'Bisher', align: 'right', width: 0.28 },
							{ label: 'Neu', align: 'right', width: 0.28 }
						],
						rows: indexLetterRows(figures)
					}
				]
			: [],
		closing: ['Mit freundlichen Grüßen', '', landlord.name]
	};
	const names = lease.tenants.map((tenant) => tenant.lastName).join(', ') || lease.unit.name;
	return {
		letter,
		filename: `Mieterhöhung ${names} ${formatDate(change.validFrom)}.pdf`,
		landlord
	};
}
