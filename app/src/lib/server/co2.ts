import { and, desc, eq } from 'drizzle-orm';
import { monthOf, today, type IsoDate } from '../dates';
import { co2Deadline, splitCo2Cost } from '../domain/co2';
import { formatCents } from '../money';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { co2CostSplits, rentCharges, type Fuel } from './db/schema';
import { getLease } from './leases';
import { chargeEntry } from './ledger';
import { assertQuota } from './quotas';

// CO₂-Kostenaufteilung for a tenant with an own fuel contract (§ 6 CO2KostAufG): the tenant
// presents the supplier invoice, the landlord's share follows from the emissions per m² of the
// dwelling and is credited on the rent ledger as a `co2_reimbursement` charge. The split row and
// its charge are written and removed together.

export type Co2SplitInput = {
	year: number;
	fuel: Fuel;
	fuelKwh: number | null;
	/** As printed on the supplier invoice. */
	co2Kg: number;
	/** In cents, as printed on the supplier invoice. */
	co2Cost: number;
	/** Floor area of the dwelling in m². */
	area: number;
	invoiceDate: IsoDate | null;
	/** The day the tenant presented the claim; the landlord settles within 12 months. */
	claimedOn: IsoDate;
};

export type Co2SplitRow = typeof co2CostSplits.$inferSelect;

export type Co2SplitEntry = Co2SplitRow & {
	kgPerSquareMetre: number;
	/** § 6 Abs. 2: claimedOn + 12 months. */
	deadline: IsoDate;
	deadlinePassed: boolean;
};

/** The splits of a lease, newest year first, with the derived figures the page shows. */
export async function listCo2Splits(
	db: Database,
	accountId: string,
	leaseId: string
): Promise<Co2SplitEntry[]> {
	const rows = await db
		.select()
		.from(co2CostSplits)
		.where(and(eq(co2CostSplits.accountId, accountId), eq(co2CostSplits.leaseId, leaseId)))
		.orderBy(desc(co2CostSplits.year));
	const date = today();
	return rows.map((row) => {
		const deadline = co2Deadline(row.claimedOn);
		return {
			...row,
			kgPerSquareMetre: row.area > 0 ? row.co2Kg / row.area : 0,
			deadline,
			deadlinePassed: deadline < date
		};
	});
}

export type Co2SplitResult =
	| { ok: true; id: string; landlordPercent: number; amount: number }
	| { ok: false; reason: 'duplicate' | 'missing' };

/**
 * Stores the split for the lease's year and posts the landlord's share as a credit on the rent
 * ledger, in one batch with the audit entry. The building use of the lease's property decides
 * the tier table. `missing` when the lease is not in the account, `duplicate` when the year is
 * already settled (one split per lease and year; delete it to enter the year again).
 */
export async function createCo2Split(
	db: Database,
	context: AuditContext,
	leaseId: string,
	input: Co2SplitInput
): Promise<Co2SplitResult> {
	const { accountId } = context;
	const lease = await getLease(db, accountId, leaseId);
	if (!lease) return { ok: false, reason: 'missing' };
	const [existing] = await db
		.select({ id: co2CostSplits.id })
		.from(co2CostSplits)
		.where(
			and(
				eq(co2CostSplits.accountId, accountId),
				eq(co2CostSplits.leaseId, leaseId),
				eq(co2CostSplits.year, input.year)
			)
		);
	if (existing) return { ok: false, reason: 'duplicate' };
	await assertQuota(db, accountId, 'co2CostSplits');
	await assertQuota(db, accountId, 'rentCharges');

	const split = splitCo2Cost({
		co2Kg: input.co2Kg,
		co2Cost: input.co2Cost,
		area: input.area,
		use: lease.property.buildingUse
	});
	const id = crypto.randomUUID();
	const charge = chargeEntry(db, context, {
		leaseId,
		kind: 'co2_reimbursement',
		period: monthOf(input.claimedOn),
		dueDate: co2Deadline(input.claimedOn),
		amount: -split.landlordAmount,
		referenceId: id,
		note: `CO2-Kostenaufteilung ${input.year}`
	});
	await runBatch(db, [
		db.insert(co2CostSplits).values({
			id,
			accountId,
			leaseId,
			year: input.year,
			fuel: input.fuel,
			fuelKwh: input.fuelKwh,
			co2Kg: input.co2Kg,
			co2Cost: input.co2Cost,
			area: input.area,
			landlordPercent: split.landlordPercent,
			amount: split.landlordAmount,
			invoiceDate: input.invoiceDate,
			claimedOn: input.claimedOn,
			createdBy: context.userId
		}),
		charge.statement,
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'post',
			`CO₂-Kostenaufteilung ${input.year}: Vermieteranteil ${split.landlordPercent} % ` +
				`(${formatCents(split.landlordAmount)}) als Gutschrift gebucht`
		)
	]);
	return {
		ok: true,
		id,
		landlordPercent: split.landlordPercent,
		amount: split.landlordAmount
	};
}

/**
 * Removes the split and the credit it posted, in one batch. `missing` when it is not a split of
 * the lease in the account.
 */
export async function deleteCo2Split(
	db: Database,
	context: AuditContext,
	leaseId: string,
	splitId: string
): Promise<'deleted' | 'missing'> {
	const { accountId } = context;
	const ofLease = and(
		eq(co2CostSplits.accountId, accountId),
		eq(co2CostSplits.leaseId, leaseId),
		eq(co2CostSplits.id, splitId)
	);
	const [split] = await db.select().from(co2CostSplits).where(ofLease);
	if (!split) return 'missing';
	await runBatch(db, [
		db
			.delete(rentCharges)
			.where(
				and(
					eq(rentCharges.accountId, accountId),
					eq(rentCharges.leaseId, leaseId),
					eq(rentCharges.kind, 'co2_reimbursement'),
					eq(rentCharges.referenceId, split.id)
				)
			),
		db.delete(co2CostSplits).where(ofLease),
		auditEntry(
			db,
			context,
			'lease',
			leaseId,
			'delete',
			`CO₂-Kostenaufteilung ${split.year} mit Gutschrift über ${formatCents(split.amount)} gelöscht`
		)
	]);
	return 'deleted';
}
