import { and, eq } from 'drizzle-orm';
import { formatDate, today, type IsoDate } from '../dates';
import {
	effectiveFrom,
	indexLetterRows,
	indexLetterText,
	indexProposal,
	indexSituation,
	latestIndex,
	letterFigures,
	nextGraduatedStepAllowed,
	referenceIndex,
	waitingPeriodEnd,
	type HistoryChange
} from '../domain/index-rent';
import {
	comparativeLetterRows,
	comparativeLetterText,
	comparativeSituation,
	demandProblem,
	type CappingPercent,
	type ComparativeDemand
} from '../domain/comparative-rent';
import { letterText as editedLetterText, type LetterTextResult } from '../domain/letters';
import { rentOn, total, type RentAmounts } from '../domain/rents';
import { personName } from '../format';
import { formatCents } from '../money';
import { addressLines, landlordAddress, type LandlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { listIndexValues } from './consumer-price-index';
import { rentChanges } from './db/schema';
import { getLease, type LeaseSummary } from './leases';
import { leaseChargeStatements } from './ledger';
import type { Letter } from './pdf';
import { laterRows, laterRowsNote, noLaterRows, withLaterRows } from './rent-history';
import { listRentChanges, type RentChangeRow } from './rents';
import { assertQuota } from './quotas';

// Changes of the rent beyond the initial one: manual changes, Staffel steps, index proposals with
// their approval and § 558 demands with the tenant's consent, the last two with their letter. Every write re-syncs the rent charges in its own batch, so the
// ledger follows the history at once, and a refused sync (the quota) leaves the history as it was.

export type AdjustmentResult = { ok: true; id: string } | { ok: false; message: string };

function refuse(message: string): AdjustmentResult {
	return { ok: false, message };
}

// Rent changes

/** One change of the lease, or undefined when it is not the lease's or not the account's. */
async function getRentChange(
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
	await assertQuota(db, context.accountId, 'rentChanges');
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

	let index: { indexMonth: string; indexValue: number; indexBaseYear: string } | undefined;
	if (lease.rentModel === 'indexed' && input.reason === 'manual') {
		const latest = latestIndex(await listIndexValues(db));
		if (latest.ok && before.baseRent !== input.baseRent) {
			index = {
				indexMonth: latest.latest.month,
				indexValue: latest.latest.value,
				indexBaseYear: latest.latest.baseYear
			};
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
	const history = [
		...withLaterRows(changes, later),
		{ ...amountsOf(input), validFrom: input.validFrom, status: 'approved' as const }
	];
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
		auditEntry(db, context, 'lease', leaseId, 'update', summary),
		...(await leaseChargeStatements(db, context.accountId, leaseId, { changes: history }))
	]);
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
	await assertQuota(db, context.accountId, 'rentChanges');
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
	const history = [
		...withLaterRows(changes, later),
		{ ...after, validFrom: input.validFrom, status: 'approved' as const }
	];
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
		),
		...(await leaseChargeStatements(db, context.accountId, leaseId, { changes: history }))
	]);
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
	await assertQuota(db, context.accountId, 'rentChanges');
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const [changes, values] = await Promise.all([
		listRentChanges(db, context.accountId, leaseId),
		listIndexValues(db)
	]);
	const day = today();
	const situation = indexSituation(lease, changes, values, day);
	if (situation.refusal) return refuse(situation.refusal);
	const proposal = situation.proposal!;
	const latest = situation.latest.ok ? situation.latest.latest : undefined;
	const current = rentOn(changes, situation.provisionalFrom) ?? rentOn(changes, '9999-12-31')!;

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
			indexBaseYear: latest!.baseYear,
			createdBy: context.userId
		}),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'create',
			`Indexanpassung der Kaltmiete auf ${formatCents(proposal.newBaseRent)} vorgeschlagen`
		),
		// A proposal is not part of the history yet; the charges are only brought up to date.
		...(await leaseChargeStatements(db, context.accountId, leaseId))
	]);
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
	// The amount was computed when the change was proposed. A change of the Kaltmiete or of the
	// reference index before the effective date since then (or another effective date) leaves it
	// on an outdated basis: the user confirmed this amount, so the proposal must be made again.
	const reference = referenceIndex(others, lease, validFrom);
	const recomputed =
		change.indexMonth && change.indexValue !== null && reference?.baseYear === change.indexBaseYear
			? indexProposal(before.baseRent, reference, {
					month: change.indexMonth,
					value: change.indexValue
				}).newBaseRent
			: undefined;
	if (recomputed !== change.baseRent) {
		return refuse(
			`Die Kaltmiete oder der Bezugsindex zum ${formatDate(validFrom)} hat sich seit dem Vorschlag geändert. Lösche den Vorschlag und lass ihn neu berechnen.`
		);
	}
	const amounts = { ...amountsOf(before), baseRent: change.baseRent };
	const approved: HistoryChange = { ...change, ...amounts, validFrom, status: 'approved' };
	const later = laterRows(db, context.accountId, others, validFrom, amountsOf(before), amounts);
	const figures = letterFigures([...others, approved], lease, approved);
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
				letterText,
				// Stored with the paragraphs, so a later correction of the history cannot make the
				// table of a downloaded letter disagree with its text.
				letterTable: indexLetterRows(figures)
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
		),
		...(await leaseChargeStatements(db, context.accountId, leaseId, {
			changes: [...withLaterRows(others, later), approved]
		}))
	]);
	return { ok: true, id: changeId };
}

/**
 * Corrects the delivery date of an approved index change, for a letter that reached the tenant
 * on another day than entered at the approval. On a residential lease the effective date follows
 * (§ 557b Abs. 3 BGB): the change moves there with the amount the tenant was told, the letter is
 * written again for the new date and the charges are re-synced. Refused while a later index or
 * Staffel change builds on it, as for deleting it. Undefined when the change is not the lease's.
 */
export async function correctDelivery(
	db: Database,
	context: AuditContext,
	leaseId: string,
	changeId: string,
	deliveredOn: IsoDate
): Promise<AdjustmentResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const change = await getRentChange(db, context.accountId, leaseId, changeId);
	if (!change) return undefined;
	if (change.status !== 'approved' || change.reason !== 'indexed') {
		return refuse('Den Zugang korrigierst du nur bei einer freigegebenen Indexanpassung.');
	}
	const validFrom = lease.kind === 'residential' ? effectiveFrom(deliveredOn) : change.validFrom;
	if (validFrom <= deliveredOn) {
		return refuse('Die neue Miete kann erst nach der Zustellung gelten.');
	}
	const changes = await listRentChanges(db, context.accountId, leaseId);
	const others = changes.filter((other) => other.id !== change.id);
	const earlier = validFrom < change.validFrom ? validFrom : change.validFrom;
	const builtOn = others.some(
		(other) =>
			other.status === 'approved' &&
			other.validFrom >= earlier &&
			(other.reason === 'indexed' || other.reason === 'graduated')
	);
	if (builtOn) {
		return refuse(
			'Der Zugang lässt sich nicht mehr korrigieren, weil eine spätere Index- oder Staffeländerung auf dieser Änderung aufbaut.'
		);
	}
	const delivery = `Zugang der Indexanpassung am ${formatDate(deliveredOn)} eingetragen`;
	const where = and(eq(rentChanges.accountId, context.accountId), eq(rentChanges.id, changeId));
	if (validFrom === change.validFrom) {
		await runBatch(db, [
			db.update(rentChanges).set({ deliveredOn }).where(where),
			auditEntry(db, context, 'lease', leaseId, 'update', delivery)
		]);
		return { ok: true, id: changeId };
	}

	if (hasApprovedOn(others, validFrom)) return sameDayRefusal(validFrom);
	// First the history without the change, as when it is deleted; then the change on its new
	// date, as when it is approved. The update statements run in that order in one batch.
	// An approved index change starts after the lease, so the initial rent is before it.
	const previous = rentOn(others, change.validFrom)!;
	const removed = laterRows(
		db,
		context.accountId,
		others,
		change.validFrom,
		amountsOf(change),
		amountsOf(previous)
	);
	const without = withLaterRows(others, removed);
	const before = rentOn(without, validFrom);
	if (!before || validFrom <= lease.startDate) {
		return refuse('Die neue Miete kann erst nach dem Beginn des Mietvertrags gelten.');
	}
	// Against the history without the change: rows that inherited its Kaltmiete have it no more.
	const waitingUntil = waitingPeriodEnd(without.filter((other) => other.validFrom < validFrom));
	if (lease.kind === 'residential' && waitingUntil && validFrom < waitingUntil) {
		return refuse(
			`Die Miete muss mindestens ein Jahr unverändert bleiben (§ 557b Abs. 2 BGB); die neue Miete kann frühestens am ${formatDate(waitingUntil)} gelten.`
		);
	}
	const amounts = { ...amountsOf(before), baseRent: change.baseRent };
	const moved: HistoryChange = { ...change, ...amounts, validFrom };
	const later = laterRows(db, context.accountId, without, validFrom, amountsOf(before), amounts);
	const figures = letterFigures([...without, moved], lease, moved);
	if (!figures) {
		return refuse('Für dieses Schreiben fehlen der Bezugsindex oder die bisherige Miete.');
	}

	await runBatch(db, [
		db
			.update(rentChanges)
			.set({
				validFrom,
				...amounts,
				deliveredOn,
				letterText: indexLetterText({ unitName: lease.unit.name, tenants: lease.tenants, figures }),
				letterTable: indexLetterRows(figures)
			})
			.where(where),
		...removed.statements,
		...later.statements,
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`${delivery}; die Kaltmiete von ${formatCents(change.baseRent)} gilt ab ${formatDate(validFrom)} statt ab ${formatDate(change.validFrom)}` +
				laterRowsNote(later)
		),
		...(await leaseChargeStatements(db, context.accountId, leaseId, {
			changes: [...withLaterRows(without, later), moved]
		}))
	]);
	return { ok: true, id: changeId };
}

// § 558: the demand and the consent

/**
 * Stores a demand for an increase to the ortsübliche Vergleichsmiete (§ 558 BGB) as a proposed
 * change with its letter: due from comparativeEffectiveFrom of the day it reaches the tenant, the
 * prepayments as they are then. It becomes part of the history with the tenant's consent.
 */
export async function demandComparativeIncrease(
	db: Database,
	context: AuditContext,
	leaseId: string,
	demand: ComparativeDemand
): Promise<AdjustmentResult | undefined> {
	await assertQuota(db, context.accountId, 'rentChanges');
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const changes = await listRentChanges(db, context.accountId, leaseId);
	const comparativeLease = { ...lease, floorArea: lease.unit.floorArea };
	const situation = comparativeSituation(comparativeLease, changes, demand.deliveredOn);
	if (situation.refusal) return refuse(situation.refusal);
	const problem = demandProblem(comparativeLease, situation, demand);
	if (problem) return refuse(problem.message);
	const { validFrom } = situation;
	if (hasApprovedOn(changes, validFrom)) return sameDayRefusal(validFrom);
	const before = rentOn(changes, validFrom)!;
	const newRent = {
		...amountsOf(before),
		baseRent: demand.baseRent,
		validFrom,
		status: 'proposed' as const
	};
	const content = {
		unitName: lease.unit.name,
		floorArea: lease.unit.floorArea!,
		tenants: lease.tenants,
		oldRent: before,
		newRent,
		capBase: situation.capBase!,
		lastChange: situation.lastChange!,
		deliveredOn: demand.deliveredOn,
		demand
	};

	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(rentChanges).values({
			id,
			accountId: context.accountId,
			leaseId,
			...newRent,
			reason: 'comparative',
			note: null,
			deliveredOn: demand.deliveredOn,
			comparativeRent: demand.comparativeRent,
			comparisonSource: demand.comparisonSource,
			comparisonDetails: demand.comparisonDetails,
			cappingPercent: demand.cappingPercent,
			letterText: comparativeLetterText(content),
			letterTable: comparativeLetterRows(content),
			createdBy: context.userId
		}),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'create',
			`Mieterhöhung nach § 558 BGB auf ${formatCents(demand.baseRent)} Kaltmiete ab ${formatDate(validFrom)} verlangt (Zugang am ${formatDate(demand.deliveredOn)})`
		),
		// A demand is not part of the history yet; the charges are only brought up to date.
		...(await leaseChargeStatements(db, context.accountId, leaseId))
	]);
	return { ok: true, id };
}

export type ConsentInput = {
	consentedOn: IsoDate;
	/** The Kaltmiete the tenant agreed to; a partial consent agrees to less than demanded. */
	baseRent: number;
};

/**
 * Checks a stored demand, with the Kaltmiete agreed to, against the history as it is now: a
 * correction made while it was pending may have moved the waiting period or the Kappungsgrenze.
 * The reason as a sentence, undefined while the demand still holds.
 */
function staleDemand(
	lease: NonNullable<Awaited<ReturnType<typeof getLease>>>,
	others: readonly HistoryChange[],
	change: RentChangeRow,
	agreed: number
): string | undefined {
	const { deliveredOn, comparativeRent, cappingPercent, comparisonSource } = change;
	if (!deliveredOn || comparativeRent === null || !cappingPercent || !comparisonSource) {
		return undefined;
	}
	const comparativeLease = { ...lease, floorArea: lease.unit.floorArea };
	const situation = comparativeSituation(comparativeLease, others, deliveredOn);
	if (situation.refusal) return situation.refusal;
	if (situation.validFrom !== change.validFrom) {
		return `Die Erhöhung wäre erst ab dem ${formatDate(situation.validFrom)} fällig.`;
	}
	return demandProblem(comparativeLease, situation, {
		deliveredOn,
		baseRent: agreed,
		comparativeRent,
		cappingPercent: cappingPercent as CappingPercent,
		comparisonSource,
		comparisonDetails: change.comparisonDetails ?? ''
	})?.message;
}

/**
 * Records the tenant's consent to a § 558 demand: the change becomes part of the history from
 * the day it is due, with the agreed Kaltmiete and the prepayments valid then. Returns undefined
 * when the lease or the change is not in the account.
 */
export async function recordConsent(
	db: Database,
	context: AuditContext,
	leaseId: string,
	changeId: string,
	input: ConsentInput
): Promise<AdjustmentResult | undefined> {
	const lease = await getLease(db, context.accountId, leaseId);
	if (!lease) return undefined;
	const change = await getRentChange(db, context.accountId, leaseId, changeId);
	if (!change || change.reason !== 'comparative') return undefined;
	if (change.status !== 'proposed') return refuse('Die Zustimmung ist schon eingetragen.');
	if (change.deliveredOn && input.consentedOn < change.deliveredOn) {
		return refuse(
			`Die Zustimmung kann nicht vor dem Zugang des Verlangens am ${formatDate(change.deliveredOn)} liegen.`
		);
	}
	const { validFrom } = change;
	const changes = await listRentChanges(db, context.accountId, leaseId);
	if (hasApprovedOn(changes, validFrom)) return sameDayRefusal(validFrom);
	const others = changes.filter((other) => other.id !== change.id);
	const before = rentOn(others, validFrom);
	if (!before) return refuse('Dem Mietvertrag fehlt die Miete bei Vertragsbeginn.');
	if (input.baseRent > change.baseRent || input.baseRent <= before.baseRent) {
		return refuse(
			`Die vereinbarte Kaltmiete muss über der bisherigen von ${formatCents(before.baseRent)} und höchstens bei den verlangten ${formatCents(change.baseRent)} liegen.`
		);
	}
	const stale = staleDemand(lease, others, change, input.baseRent);
	if (stale) {
		return refuse(
			`Das Verlangen passt nicht mehr zur Miethistorie: ${stale} Lösche es und stelle es neu.`
		);
	}
	const amounts = { ...amountsOf(before), baseRent: input.baseRent };
	const approved: HistoryChange = { ...change, ...amounts, status: 'approved' };
	const later = laterRows(db, context.accountId, others, validFrom, amountsOf(before), amounts);
	await runBatch(db, [
		db
			.update(rentChanges)
			.set({ status: 'approved', ...amounts, consentedOn: input.consentedOn })
			.where(and(eq(rentChanges.accountId, context.accountId), eq(rentChanges.id, changeId))),
		...later.statements,
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'approve',
			`Zustimmung zur Mieterhöhung vom ${formatDate(input.consentedOn)}: Kaltmiete ${formatCents(input.baseRent)} ab ${formatDate(validFrom)}` +
				laterRowsNote(later)
		),
		...(await leaseChargeStatements(db, context.accountId, leaseId, {
			changes: [...withLaterRows(others, later), approved]
		}))
	]);
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
		: noLaterRows;
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
		),
		...(await leaseChargeStatements(db, context.accountId, leaseId, {
			changes: withLaterRows(others, later)
		}))
	]);
	return { ok: true };
}

// The letter

/** The tenants' address for the window of the letter: the first tenant with one, else the unit's. */
export function recipientLines(lease: LeaseSummary): string[] {
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
 * Replaces the paragraphs of a rent letter with those edited on its sheet. Undefined when the
 * change is not the lease's or has no letter.
 */
export async function updateRentLetterText(
	db: Database,
	context: AuditContext,
	leaseId: string,
	changeId: string,
	paragraphs: unknown
): Promise<LetterTextResult | undefined> {
	const change = await getRentChange(db, context.accountId, leaseId, changeId);
	if (!change?.letterText) return undefined;
	const result = editedLetterText(paragraphs, 1);
	if (!result.ok || result.text === change.letterText) return result;
	await runBatch(db, [
		db
			.update(rentChanges)
			.set({ letterText: result.text })
			.where(and(eq(rentChanges.accountId, context.accountId), eq(rentChanges.id, changeId))),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'update',
			`Text des Mieterhöhungsschreibens ab ${formatDate(change.validFrom)} geändert`
		)
	]);
	return result;
}

const letterSubjects: Partial<Record<RentChangeRow['reason'], string>> = {
	indexed: 'Mieterhöhung nach § 557b BGB',
	comparative: 'Mieterhöhung auf die ortsübliche Vergleichsmiete (§ 558 BGB)'
};

/**
 * The letter of an index change or a § 558 demand as a Letter for renderLetter; undefined when
 * the change is not the lease's or carries no letter text.
 */
export async function rentLetter(
	db: Database,
	accountId: string,
	leaseId: string,
	changeId: string
): Promise<{ letter: Letter; filename: string; landlord: LandlordAddress } | undefined> {
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return undefined;
	const change = await getRentChange(db, accountId, leaseId, changeId);
	if (!change || !change.letterText || !change.letterTable) return undefined;
	const landlord = await landlordAddress(db, accountId);

	const date = formatDate(change.deliveredOn ?? today());
	const letter: Letter = {
		sender: addressLines(landlord),
		recipient: recipientLines(lease),
		date: landlord.city ? `${landlord.city}, ${date}` : date,
		subject: letterSubjects[change.reason] ?? 'Mieterhöhung',
		paragraphs: change.letterText.split('\n\n'),
		tables: [
			{
				columns: [
					{ label: '' },
					{ label: 'Bisher', align: 'right', width: 0.28 },
					{ label: 'Neu', align: 'right', width: 0.28 }
				],
				rows: change.letterTable
			}
		],
		closing: ['Mit freundlichen Grüßen', '', landlord.name]
	};
	const names = lease.tenants.map((tenant) => tenant.lastName).join(', ') || lease.unit.name;
	return {
		letter,
		filename: `Mieterhöhung ${names} ${formatDate(change.validFrom)}.pdf`,
		landlord
	};
}
