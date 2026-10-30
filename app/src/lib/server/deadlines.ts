import { and, eq, isNotNull } from 'drizzle-orm';
import {
	addDays,
	addMonths,
	addMonthsToMonth,
	daysBetween,
	firstOfMonth,
	formatDate,
	monthOf,
	today as todayInBerlin,
	type IsoDate
} from '../dates';
import { co2Deadline } from '../domain/co2';
import { consentDeadline, lastBaseRentChange, lawsuitDeadline } from '../domain/comparative-rent';
import { depositInstalments } from '../domain/deposit';
import { nextCancellation } from '../domain/insurance';
import { leaseEndDeadlines } from '../domain/lease-end';
import { objectionDeadline, periodLabel, statementDeadline } from '../domain/statement';
import { insuranceKindLabels } from '../labels';
import { personName } from '../format';
import { formatCents } from '../money';
import type { Database } from './db';
import {
	co2CostSplits,
	depositTransactions,
	insurancePolicies,
	meterReadings,
	meters,
	operatingCostStatements,
	properties,
	rentChanges,
	statementResults
} from './db/schema';
import { cite, type Citation } from './law';
import { leaseLabel, listLeases, type LeaseSummary } from './leases';

// Fristen: deadlines that follow from the data, computed on every request and never stored. Each
// row links to the page where the matter is handled. Rows that only inform (a date to know,
// nothing the landlord has to do by then) disappear once the date has passed; rows that name
// something to do stay and are marked overdue.

export type DeadlineKind =
	| 'statement'
	| 'objection'
	| 'lease_end'
	| 'deposit_instalment'
	| 'deposit_return'
	| 'graduated_step'
	| 'index_proposal'
	| 'comparative_possible'
	| 'comparative_consent'
	| 'co2_reimbursement'
	| 'meter_reading'
	| 'insurance_notice'
	| 'insurance_end';

/**
 * The law each kind of deadline follows from; none where no statute sets it (the lease end, the
 * deposit return, insurance). The final meter reading has none either: § 9b HeizkostenV covers
 * heating and hot water meters only, the row also stands for cold water and electricity.
 */
export const deadlineLegalBasis: Record<DeadlineKind, Citation[]> = {
	statement: [cite('bgb-556', 'Abs. 3 Satz 2 und 3')],
	objection: [cite('bgb-556', 'Abs. 3 Satz 5 und 6')],
	lease_end: [],
	deposit_instalment: [cite('bgb-551', 'Abs. 2')],
	deposit_return: [],
	graduated_step: [cite('bgb-557a')],
	index_proposal: [cite('bgb-557b', 'Abs. 2 und 3')],
	comparative_possible: [cite('bgb-558', 'Abs. 1')],
	comparative_consent: [cite('bgb-558b', 'Abs. 1 und 2')],
	co2_reimbursement: [cite('co2kostaufg-6', 'Abs. 2')],
	meter_reading: [],
	insurance_notice: [],
	insurance_end: []
};

export type Deadline = {
	kind: DeadlineKind;
	date: IsoDate;
	/** German, e.g. "Betriebskostenabrechnung 2025". */
	title: string;
	detail?: string;
	href: string;
	leaseId?: string;
	propertyId?: string;
	overdue: boolean;
};

export type DeadlineFilter = {
	/** Earliest date to include; overdue rows are included whatever `from` says. */
	from?: IsoDate;
	/** Latest date to include. */
	to?: IsoDate;
	/** The current date; tests pass a fixed one. */
	today?: IsoDate;
};

/** Days a reading may lie from the lease end and still count as its final reading. */
const READING_TOLERANCE_DAYS = 3;

function leaseDetail(lease: LeaseSummary): string {
	const names = lease.tenants.map(personName).join(', ');
	return names ? `${names} · ${leaseLabel(lease)}` : leaseLabel(lease);
}

type Period = { start: IsoDate; end: IsoDate };

/**
 * The ended billing periods of a property that overlap one of its leases, from the first lease
 * on: the periods of its statements as they are, calendar years before the first statement (the
 * last one cut short where that statement starts), and after a statement twelve months each in
 * its rhythm until the next statement or today.
 */
export function billingPeriods(
	statements: { periodStart: IsoDate; periodEnd: IsoDate }[],
	leases: Period[],
	today: IsoDate
): Period[] {
	if (leases.length === 0) return [];
	const known = [
		...new Map(
			statements.map((row) => [
				`${row.periodStart}:${row.periodEnd}`,
				{ start: row.periodStart, end: row.periodEnd }
			])
		).values()
	].sort((a, b) => a.start.localeCompare(b.start));
	const periods: Period[] = [];
	// From the first statement on, even one before every lease, so that its rhythm carries over.
	let cursor = leases.reduce(
		(min, lease) => (lease.start < min ? lease.start : min),
		known[0]?.start ?? '9999-12-31'
	);
	let previous: Period | undefined;
	while (cursor <= today) {
		const next = known.find((period) => period.end >= cursor);
		let period: Period;
		if (next && next.start <= cursor) {
			period = next;
		} else {
			period = previous
				? { start: cursor, end: addDays(addMonths(cursor, 12), -1) }
				: { start: `${cursor.slice(0, 4)}-01-01`, end: `${cursor.slice(0, 4)}-12-31` };
			if (next && period.end >= next.start) period.end = addDays(next.start, -1);
		}
		if (period.end > today) break;
		if (leases.some((lease) => lease.start <= period.end && lease.end >= period.start)) {
			periods.push(period);
		}
		previous = period;
		cursor = addDays(period.end, 1);
	}
	return periods;
}

/**
 * Every deadline of the account sorted by date: the ones to do (overdue ones included, whatever
 * `from` says) and the ones to know about that lie ahead. A fixed number of queries however large
 * the account: listLeases plus eight selects.
 */
export async function listDeadlines(
	db: Database,
	accountId: string,
	filter: DeadlineFilter = {}
): Promise<Deadline[]> {
	const today = filter.today ?? todayInBerlin();
	const allLeases = await listLeases(db, accountId);
	const [
		changeRows,
		depositRows,
		statementRows,
		resultRows,
		splitRows,
		meterRows,
		readingRows,
		policyRows
	] = await Promise.all([
		db.select().from(rentChanges).where(eq(rentChanges.accountId, accountId)),
		db
			.select({
				leaseId: depositTransactions.leaseId,
				amount: depositTransactions.amount,
				kind: depositTransactions.kind
			})
			.from(depositTransactions)
			.where(eq(depositTransactions.accountId, accountId)),
		db
			.select({
				id: operatingCostStatements.id,
				propertyId: operatingCostStatements.propertyId,
				periodStart: operatingCostStatements.periodStart,
				periodEnd: operatingCostStatements.periodEnd,
				version: operatingCostStatements.version,
				status: operatingCostStatements.status
			})
			.from(operatingCostStatements)
			.where(eq(operatingCostStatements.accountId, accountId)),
		db
			.select({
				statementId: statementResults.statementId,
				leaseId: statementResults.leaseId,
				deliveredOn: statementResults.deliveredOn
			})
			.from(statementResults)
			.where(eq(statementResults.accountId, accountId)),
		db
			.select({
				leaseId: co2CostSplits.leaseId,
				year: co2CostSplits.year,
				amount: co2CostSplits.amount,
				claimedOn: co2CostSplits.claimedOn
			})
			.from(co2CostSplits)
			.where(eq(co2CostSplits.accountId, accountId)),
		db
			.select({
				id: meters.id,
				unitId: meters.unitId,
				installedAt: meters.installedAt,
				removedAt: meters.removedAt
			})
			.from(meters)
			.where(and(eq(meters.accountId, accountId), isNotNull(meters.unitId))),
		db
			.select({ meterId: meterReadings.meterId, readAt: meterReadings.readAt })
			.from(meterReadings)
			.where(eq(meterReadings.accountId, accountId)),
		db
			.select({
				id: insurancePolicies.id,
				propertyId: insurancePolicies.propertyId,
				propertyName: properties.name,
				kind: insurancePolicies.kind,
				insurer: insurancePolicies.insurer,
				renewalDate: insurancePolicies.renewalDate,
				noticeMonths: insurancePolicies.noticeMonths,
				endDate: insurancePolicies.endDate
			})
			.from(insurancePolicies)
			.innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
			.where(eq(insurancePolicies.accountId, accountId))
	]);

	const leaseById = new Map(allLeases.map((lease) => [lease.id, lease]));
	const deadlines: Deadline[] = [];
	const push = (deadline: Omit<Deadline, 'overdue'>, actionable = true) => {
		if (deadline.date < today && !actionable) return;
		deadlines.push({ ...deadline, overdue: deadline.date < today });
	};

	// Betriebskostenabrechnung (§ 556 Abs. 3 BGB): per property and ended billing period with a
	// residential lease, until an approved statement for that period exists; then per residential
	// lease of that statement until its delivery is recorded, since the deadline is about the
	// statement reaching the tenant. The periods are those of the property's statements; before the
	// first one they are calendar years, after the last one they continue its rhythm (a July to June
	// period is followed by the next July to June). Periods before a lease's ledger start are not the
	// app's business.
	const leasesByProperty = new Map<string, { start: IsoDate; end: IsoDate }[]>();
	for (const lease of allLeases) {
		if (lease.kind !== 'residential') continue;
		// A lease with Pauschale or Inklusivmiete for both cost groups gets no statement.
		if (lease.operatingCostModel !== 'prepayment' && lease.heatingCostModel !== 'prepayment') {
			continue;
		}
		const start =
			lease.ledgerStart && lease.ledgerStart > lease.startDate
				? lease.ledgerStart
				: lease.startDate;
		let ranges = leasesByProperty.get(lease.property.id);
		if (!ranges) leasesByProperty.set(lease.property.id, (ranges = []));
		ranges.push({ start, end: lease.endDate ?? '9999-12-31' });
	}
	for (const [propertyId, ranges] of leasesByProperty) {
		const property = allLeases.find((lease) => lease.property.id === propertyId)?.property;
		const statements = statementRows.filter((row) => row.propertyId === propertyId);
		for (const period of billingPeriods(statements, ranges, today)) {
			const deadline = statementDeadline(period.end);
			const label = periodLabel(period.start, period.end);
			const approved = statements.filter(
				(row) =>
					row.status === 'approved' &&
					row.periodStart === period.start &&
					row.periodEnd === period.end
			);
			if (approved.length === 0) {
				push({
					kind: 'statement',
					date: deadline,
					title: `Betriebskostenabrechnung ${label}`,
					detail: `${property?.name ?? 'Objekt'}: die Abrechnung muss den Mietern bis zum ${formatDate(deadline)} zugehen.`,
					href: '/betriebskosten',
					propertyId
				});
				continue;
			}
			// A delivery of any version (the original or a correction) meets the deadline; an
			// undelivered lease links to the latest version.
			approved.sort((a, b) => b.version - a.version);
			const results = approved.flatMap((statement) =>
				resultRows.filter((row) => row.statementId === statement.id)
			);
			const delivered = new Set(results.filter((row) => row.deliveredOn).map((row) => row.leaseId));
			const pending = new Map<string, string>();
			for (const result of results) {
				if (delivered.has(result.leaseId) || pending.has(result.leaseId)) continue;
				pending.set(result.leaseId, result.statementId);
			}
			for (const [leaseId, statementId] of pending) {
				const lease = leaseById.get(leaseId);
				if (!lease || lease.kind !== 'residential') continue;
				push({
					kind: 'statement',
					date: deadline,
					title: `Betriebskostenabrechnung ${label} zustellen`,
					detail: `${leaseDetail(lease)}: die Abrechnung muss bis zum ${formatDate(deadline)} zugehen; trag die Zustellung ein.`,
					href: `/betriebskosten/abrechnungen/${statementId}`,
					leaseId,
					propertyId
				});
			}
		}
	}

	// Einwendungsfrist: the tenant may object until the end of the twelfth month after receiving
	// the statement.
	const statementById = new Map(statementRows.map((row) => [row.id, row]));
	for (const result of resultRows) {
		const lease = leaseById.get(result.leaseId);
		const statement = statementById.get(result.statementId);
		if (!lease || !statement || !result.deliveredOn) continue;
		push(
			{
				kind: 'objection',
				date: objectionDeadline(result.deliveredOn),
				title: `Einwendungsfrist Betriebskostenabrechnung ${periodLabel(statement.periodStart, statement.periodEnd)}`,
				detail: `${leaseDetail(lease)} · zugestellt am ${formatDate(result.deliveredOn)}`,
				href: `/betriebskosten/abrechnungen/${statement.id}`,
				leaseId: lease.id,
				propertyId: lease.property.id
			},
			false
		);
	}

	// Per lease: end, deposit, Staffel, index, § 558, CO₂, meters.
	const changesByLease = new Map<string, typeof changeRows>();
	const demandsByLease = new Map<string, typeof changeRows>();
	for (const change of changeRows) {
		if (change.status !== 'approved') {
			if (change.reason === 'comparative' && change.deliveredOn) {
				const demands = demandsByLease.get(change.leaseId);
				if (demands) demands.push(change);
				else demandsByLease.set(change.leaseId, [change]);
			}
			continue;
		}
		const list = changesByLease.get(change.leaseId);
		if (list) list.push(change);
		else changesByLease.set(change.leaseId, [change]);
	}
	for (const list of changesByLease.values()) {
		list.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
	}
	const metersByUnit = new Map<string, typeof meterRows>();
	for (const meter of meterRows) {
		if (!meter.unitId) continue;
		const list = metersByUnit.get(meter.unitId);
		if (list) list.push(meter);
		else metersByUnit.set(meter.unitId, [meter]);
	}

	for (const lease of allLeases) {
		const base = { leaseId: lease.id, propertyId: lease.property.id };
		const detail = leaseDetail(lease);
		const ended = lease.endDate !== null && lease.endDate < today;
		const movements = depositRows.filter((row) => row.leaseId === lease.id);

		if (lease.endDate) {
			const end = leaseEndDeadlines(lease.endDate);
			push(
				{
					kind: 'lease_end',
					date: lease.endDate,
					title: 'Vertragsende',
					detail,
					href: `/vertraege/${lease.id}`,
					...base
				},
				false
			);

			// Kaution abrechnen: 6 months after the end, until the movements net to zero. A lease
			// without any movement still has the agreed deposit to settle.
			const net = movements.reduce((sum, row) => sum + row.amount, 0);
			const settled = movements.length > 0 ? net === 0 : lease.securityDeposit === 0;
			if (!settled) {
				push({
					kind: 'deposit_return',
					date: end.settleDeposit,
					title: 'Kaution abrechnen',
					detail,
					href: `/vertraege/${lease.id}/kaution`,
					...base
				});
			}

			// Zählerstände ablesen at the end, when the unit has meters in place on that day and no
			// final reading yet. A meter removed before the end or installed after it is not read.
			const endDate = end.readMeters;
			const meterIds = [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)]
				.flatMap((unitId) => metersByUnit.get(unitId) ?? [])
				.filter(
					(meter) =>
						(meter.installedAt === null || meter.installedAt <= endDate) &&
						(meter.removedAt === null || meter.removedAt >= endDate)
				)
				.map((meter) => meter.id);
			if (meterIds.length > 0) {
				const read = meterIds.every((meterId) =>
					readingRows.some(
						(reading) =>
							reading.meterId === meterId &&
							Math.abs(daysBetween(endDate, reading.readAt)) <= READING_TOLERANCE_DAYS
					)
				);
				if (!read) {
					push({
						kind: 'meter_reading',
						date: endDate,
						title: 'Zählerstände ablesen',
						detail,
						href: `/objekte/${lease.property.id}/zaehler`,
						...base
					});
				}
			}
		}

		// Kaution in drei Raten (§ 551 Abs. 2 BGB), due with the first three rents (not before the
		// lease starts), until the received amount covers them. An ended lease collects no deposit
		// any more.
		if (!ended) {
			const received = movements
				.filter((row) => row.kind === 'received')
				.reduce((sum, row) => sum + row.amount, 0);
			const instalments = depositInstalments({ ...lease, state: lease.property.state });
			let covered = 0;
			for (const [index, instalment] of instalments.entries()) {
				covered += instalment.amount;
				if (received >= covered) continue;
				push({
					kind: 'deposit_instalment',
					date: instalment.dueDate,
					title: `Kaution: ${index + 1}. Rate fällig`,
					detail: `${formatCents(instalment.amount)} von ${formatCents(lease.securityDeposit)} · ${detail}`,
					href: `/vertraege/${lease.id}/kaution`,
					...base
				});
			}
		}

		const history = changesByLease.get(lease.id) ?? [];

		// The next Staffel step, to know about.
		if (lease.rentModel === 'graduated' && !ended) {
			const next = history.find(
				(change) => change.reason === 'graduated' && change.validFrom > today
			);
			if (next) {
				push(
					{
						kind: 'graduated_step',
						date: next.validFrom,
						title: 'Nächste Mietstaffel',
						detail: `Kaltmiete ${formatCents(next.baseRent)} ab ${formatDate(next.validFrom)} · ${detail}`,
						href: `/vertraege/${lease.id}/miethoehe`,
						...base
					},
					false
				);
			}
		}

		// Earliest next index proposal (§ 557b Abs. 2 BGB): 12 months after the last change of
		// the base rent; § 560 prepayment changes do not count.
		if (lease.rentModel === 'indexed' && lease.kind === 'residential' && !ended) {
			let lastChange: IsoDate | undefined;
			let previousBaseRent: number | undefined;
			for (const change of history) {
				if (change.reason === 'statement') continue;
				if (previousBaseRent === undefined || change.baseRent !== previousBaseRent) {
					lastChange = change.validFrom;
				}
				previousBaseRent = change.baseRent;
			}
			if (lastChange) {
				// The proposal may go out two months before it takes effect (§ 557b Abs. 3 BGB: from
				// the start of the month after next), so the row names the earliest sending date.
				const effective = addMonths(lastChange, 12);
				const sendFrom = firstOfMonth(
					addMonthsToMonth(monthOf(effective), effective.endsWith('-01') ? -2 : -1)
				);
				push(
					{
						kind: 'index_proposal',
						date: sendFrom,
						title: 'Indexanpassung frühestens möglich',
						detail: `Erhöhung kann ab ${formatDate(sendFrom)} verlangt werden und frühestens ab ${formatDate(effective)} gelten; letzte Änderung der Kaltmiete am ${formatDate(lastChange)} · ${detail}`,
						href: `/vertraege/${lease.id}/miethoehe`,
						...base
					},
					false
				);
			}
		}

		// § 558: the earliest day to ask for an increase to the Vergleichsmiete, to know about, and a
		// demand waiting for the tenant's consent: first the consent period, then the three months
		// to sue for it (§ 558b Abs. 2 BGB).
		if (lease.rentModel === 'fixed' && lease.kind === 'residential' && !ended) {
			const demands = demandsByLease.get(lease.id) ?? [];
			const lastChange = lastBaseRentChange(history);
			if (lastChange && demands.length === 0) {
				const demandFrom = addMonths(lastChange, 12);
				push(
					{
						kind: 'comparative_possible',
						date: demandFrom,
						title: 'Mieterhöhung nach § 558 möglich',
						detail: `Erhöhung bis zur Vergleichsmiete kann ab ${formatDate(demandFrom)} verlangt werden; letzte Änderung der Kaltmiete am ${formatDate(lastChange)} · ${detail}`,
						href: `/vertraege/${lease.id}/miethoehe`,
						...base
					},
					false
				);
			}
			for (const demand of demands) {
				const consentBy = consentDeadline(demand.deliveredOn!);
				const suing = consentBy < today;
				push({
					kind: 'comparative_consent',
					date: suing ? lawsuitDeadline(demand.deliveredOn!) : consentBy,
					title: suing ? 'Klagefrist Mieterhöhung' : 'Zustimmung zur Mieterhöhung',
					detail: suing
						? `Der Mieter hat der Erhöhung auf ${formatCents(demand.baseRent)} bis zum ${formatDate(consentBy)} nicht zugestimmt; trag die Zustimmung ein, klag auf Zustimmung oder lösche das Verlangen · ${detail}`
						: `Kaltmiete ${formatCents(demand.baseRent)} ab ${formatDate(demand.validFrom)}; trag die Zustimmung ein, sobald sie vorliegt · ${detail}`,
					href: `/vertraege/${lease.id}/miethoehe`,
					...base
				});
			}
		}

		// CO₂ reimbursement for a tenant's own fuel contract: settle within 12 months of the claim.
		for (const split of splitRows) {
			if (split.leaseId !== lease.id) continue;
			push(
				{
					kind: 'co2_reimbursement',
					date: co2Deadline(split.claimedOn),
					title: `CO₂-Kostenanteil ${split.year} erstatten`,
					detail: `${formatCents(split.amount)} · ${detail}`,
					href: `/vertraege/${lease.id}/co2`,
					...base
				},
				false
			);
		}
	}

	// Versicherungen: the last day to cancel before the next renewal, to know about; a cancelled
	// policy shows the end of its cover instead.
	for (const policy of policyRows) {
		const base = {
			href: `/objekte/${policy.propertyId}/versicherungen/${policy.id}`,
			propertyId: policy.propertyId
		};
		const label = insuranceKindLabels[policy.kind];
		if (policy.endDate) {
			push(
				{
					kind: 'insurance_end',
					date: policy.endDate,
					title: `${label} endet`,
					detail: `${policy.insurer} · ${policy.propertyName}`,
					...base
				},
				false
			);
			continue;
		}
		const { renewal, deadline } = nextCancellation(policy.renewalDate, policy.noticeMonths, today);
		push(
			{
				kind: 'insurance_notice',
				date: deadline,
				title: `Kündigungsfrist ${label}`,
				detail: `${policy.insurer} · ${policy.propertyName}: kündbar zum ${formatDate(addDays(renewal, -1))}, sonst verlängert sie sich um ein Jahr.`,
				...base
			},
			false
		);
	}

	return deadlines
		.filter(
			(deadline) =>
				(deadline.overdue || !filter.from || deadline.date >= filter.from) &&
				(!filter.to || deadline.date <= filter.to)
		)
		.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'de'));
}
