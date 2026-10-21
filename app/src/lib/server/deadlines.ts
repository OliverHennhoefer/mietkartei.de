import { and, eq, isNotNull } from 'drizzle-orm';
import {
	addMonths,
	addMonthsToMonth,
	daysBetween,
	firstOfMonth,
	formatDate,
	monthOf,
	today as todayInBerlin,
	type IsoDate
} from '../dates';
import { objectionDeadline, statementDeadline } from '../domain/statement';
import { personName } from '../format';
import { distributeCents, formatCents } from '../money';
import { nthWorkingDay } from '../working-days';
import type { Database } from './db';
import {
	co2CostSplits,
	depositTransactions,
	meterReadings,
	meters,
	operatingCostStatements,
	rentChanges,
	statementResults
} from './db/schema';
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
	| 'co2_reimbursement'
	| 'meter_reading';

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

function yearOf(date: IsoDate): number {
	return Number(date.slice(0, 4));
}

/**
 * Every deadline of the account sorted by date: the ones to do (overdue ones included, whatever
 * `from` says) and the ones to know about that lie ahead. A fixed number of queries however large
 * the account: listLeases plus seven selects.
 */
export async function listDeadlines(
	db: Database,
	accountId: string,
	filter: DeadlineFilter = {}
): Promise<Deadline[]> {
	const today = filter.today ?? todayInBerlin();
	const allLeases = await listLeases(db, accountId);
	const [changeRows, depositRows, statementRows, resultRows, splitRows, meterRows, readingRows] =
		await Promise.all([
			db
				.select()
				.from(rentChanges)
				.where(and(eq(rentChanges.accountId, accountId), eq(rentChanges.status, 'approved'))),
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
				.select({ id: meters.id, unitId: meters.unitId })
				.from(meters)
				.where(and(eq(meters.accountId, accountId), isNotNull(meters.unitId))),
			db
				.select({ meterId: meterReadings.meterId, readAt: meterReadings.readAt })
				.from(meterReadings)
				.where(eq(meterReadings.accountId, accountId))
		]);

	const leaseById = new Map(allLeases.map((lease) => [lease.id, lease]));
	const deadlines: Deadline[] = [];
	const push = (deadline: Omit<Deadline, 'overdue'>, actionable = true) => {
		if (deadline.date < today && !actionable) return;
		deadlines.push({ ...deadline, overdue: deadline.date < today });
	};

	// Betriebskostenabrechnung (§ 556 Abs. 3 BGB): per property and ended calendar year with a
	// residential lease, until an approved statement covers the end of that year; then per residential
	// lease of that statement until its delivery is recorded, since the deadline is about the statement
	// reaching the tenant. Years before a lease's ledger start are not the app's business.
	const yearsByProperty = new Map<string, Set<number>>();
	for (const lease of allLeases) {
		if (lease.kind !== 'residential') continue;
		// A lease with Pauschale or Inklusivmiete for both cost groups gets no statement.
		if (lease.operatingCostModel !== 'prepayment' && lease.heatingCostModel !== 'prepayment') {
			continue;
		}
		const bookkeepingStart =
			lease.ledgerStart && lease.ledgerStart > lease.startDate
				? lease.ledgerStart
				: lease.startDate;
		const lastYear = Math.min(
			yearOf(lease.endDate ?? today),
			yearOf(today) - (today.endsWith('-12-31') ? 0 : 1)
		);
		for (let year = yearOf(bookkeepingStart); year <= lastYear; year += 1) {
			let years = yearsByProperty.get(lease.property.id);
			if (!years) yearsByProperty.set(lease.property.id, (years = new Set()));
			years.add(year);
		}
	}
	for (const [propertyId, years] of yearsByProperty) {
		const property = allLeases.find((lease) => lease.property.id === propertyId)?.property;
		for (const year of years) {
			const periodEnd = `${year}-12-31`;
			const deadline = statementDeadline(periodEnd);
			const approved = statementRows.filter(
				(row) =>
					row.propertyId === propertyId &&
					row.status === 'approved' &&
					row.periodStart <= periodEnd &&
					row.periodEnd >= periodEnd
			);
			if (approved.length === 0) {
				push({
					kind: 'statement',
					date: deadline,
					title: `Betriebskostenabrechnung ${year}`,
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
					title: `Betriebskostenabrechnung ${year} zustellen`,
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
				title: `Einwendungsfrist Betriebskostenabrechnung ${yearOf(statement.periodEnd)}`,
				detail: `${leaseDetail(lease)} · zugestellt am ${formatDate(result.deliveredOn)}`,
				href: `/betriebskosten/abrechnungen/${statement.id}`,
				leaseId: lease.id,
				propertyId: lease.property.id
			},
			false
		);
	}

	// Per lease: end, deposit, Staffel, index, CO₂, meters.
	const changesByLease = new Map<string, typeof changeRows>();
	for (const change of changeRows) {
		const list = changesByLease.get(change.leaseId);
		if (list) list.push(change);
		else changesByLease.set(change.leaseId, [change]);
	}
	for (const list of changesByLease.values()) {
		list.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
	}
	const metersByUnit = new Map<string, string[]>();
	for (const meter of meterRows) {
		if (!meter.unitId) continue;
		const list = metersByUnit.get(meter.unitId);
		if (list) list.push(meter.id);
		else metersByUnit.set(meter.unitId, [meter.id]);
	}

	for (const lease of allLeases) {
		const base = { leaseId: lease.id, propertyId: lease.property.id };
		const detail = leaseDetail(lease);
		const ended = lease.endDate !== null && lease.endDate < today;
		const movements = depositRows.filter((row) => row.leaseId === lease.id);

		if (lease.endDate) {
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
					date: addMonths(lease.endDate, 6),
					title: 'Kaution abrechnen',
					detail,
					href: `/vertraege/${lease.id}/kaution`,
					...base
				});
			}

			// Zählerstände ablesen at the end, when the unit has meters and no final reading yet.
			const meterIds = [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)].flatMap(
				(unitId) => metersByUnit.get(unitId) ?? []
			);
			if (meterIds.length > 0) {
				const endDate = lease.endDate;
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
						date: lease.endDate,
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
		if (lease.kind === 'residential' && lease.securityDeposit > 0 && !ended) {
			const received = movements
				.filter((row) => row.kind === 'received')
				.reduce((sum, row) => sum + row.amount, 0);
			const instalments = distributeCents(lease.securityDeposit, [1, 1, 1]);
			let covered = 0;
			for (let index = 0; index < 3; index += 1) {
				covered += instalments[index];
				if (received >= covered) continue;
				const month = monthOf(addMonths(lease.startDate, index));
				const dueDate = nthWorkingDay(month, Math.max(1, lease.rentDueDay));
				push({
					kind: 'deposit_instalment',
					date: dueDate < lease.startDate ? lease.startDate : dueDate,
					title: `Kaution: ${index + 1}. Rate fällig`,
					detail: `${formatCents(instalments[index])} von ${formatCents(lease.securityDeposit)} · ${detail}`,
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

		// CO₂ reimbursement for a tenant's own fuel contract: settle within 12 months of the claim.
		for (const split of splitRows) {
			if (split.leaseId !== lease.id) continue;
			push(
				{
					kind: 'co2_reimbursement',
					date: addMonths(split.claimedOn, 12),
					title: `CO₂-Kostenanteil ${split.year} erstatten`,
					detail: `${formatCents(split.amount)} · ${detail}`,
					href: `/vertraege/${lease.id}/co2`,
					...base
				},
				false
			);
		}
	}

	return deadlines
		.filter(
			(deadline) =>
				(deadline.overdue || !filter.from || deadline.date >= filter.from) &&
				(!filter.to || deadline.date <= filter.to)
		)
		.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'de'));
}

/**
 * For the dashboard tile: how many deadlines are overdue and how many lie within `months`
 * (default twelve). Runs the same queries as listDeadlines; nothing is cheaper to compute.
 */
export async function countDeadlines(
	db: Database,
	accountId: string,
	options: { months?: number; today?: IsoDate } = {}
): Promise<{ overdue: number; upcoming: number }> {
	const today = options.today ?? todayInBerlin();
	const deadlines = await listDeadlines(db, accountId, {
		to: addMonths(today, options.months ?? 12),
		today
	});
	const overdue = deadlines.filter((deadline) => deadline.overdue).length;
	return { overdue, upcoming: deadlines.length - overdue };
}
