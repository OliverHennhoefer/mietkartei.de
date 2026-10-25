import { and, asc, eq } from 'drizzle-orm';
import { formatDate, today as todayInBerlin, type DateRange } from '../dates';
import { allocableInsuranceKinds, insuranceYearsFor, premiumFor } from '../domain/insurance';
import { insuranceKindLabels } from '../labels';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	costCategories,
	costItems,
	insurancePolicies,
	properties,
	type InsuranceKind
} from './db/schema';
import { assertQuota } from './quotas';

// Versicherungen of a property: stored with their Hauptfälligkeit and notice period, so the
// notice deadline shows up among the Fristen and each insurance year can be entered as a Beleg.

export type InsurancePolicyInput = {
	kind: InsuranceKind;
	insurer: string;
	policyNumber: string | null;
	annualPremium: number;
	renewalDate: string;
	noticeMonths: number;
	endDate: string | null;
	note: string | null;
};

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;

/** An insurance year a statement of last or this calendar year needs, and whether its Beleg is in. */
export type InsuranceYear = DateRange & { amount: number; costItemId: string | null };

export type InsurancePolicyWithYears = InsurancePolicy & { years: InsuranceYear[] };

/** "Wohngebäudeversicherung (Allianz)" for audit lines and Belege. */
function policyLabel(policy: { kind: InsuranceKind; insurer: string }): string {
	return `${insuranceKindLabels[policy.kind]} (${policy.insurer})`;
}

export async function listPolicies(
	db: Database,
	accountId: string,
	propertyId: string,
	today = todayInBerlin()
): Promise<InsurancePolicyWithYears[]> {
	const [rows, items] = await Promise.all([
		db
			.select()
			.from(insurancePolicies)
			.where(
				and(
					eq(insurancePolicies.accountId, accountId),
					eq(insurancePolicies.propertyId, propertyId)
				)
			)
			.orderBy(asc(insurancePolicies.createdAt)),
		db
			.select({
				id: costItems.id,
				insurancePolicyId: costItems.insurancePolicyId,
				periodStart: costItems.periodStart
			})
			.from(costItems)
			.where(and(eq(costItems.accountId, accountId), eq(costItems.propertyId, propertyId)))
	]);
	const year = Number(today.slice(0, 4));
	return rows.map((policy) => ({
		...policy,
		// A Beleg counts as entered when it was taken over from this policy for the year.
		years: insuranceYearsFor(policy, [year - 1, year]).map(({ start, end, fullEnd }) => ({
			start,
			end,
			amount: premiumFor(policy.annualPremium, { start, end, fullEnd }),
			costItemId:
				items.find((item) => item.insurancePolicyId === policy.id && item.periodStart === start)
					?.id ?? null
		}))
	}));
}

export async function getPolicy(
	db: Database,
	accountId: string,
	policyId: string
): Promise<InsurancePolicy | undefined> {
	const [policy] = await db
		.select()
		.from(insurancePolicies)
		.where(and(eq(insurancePolicies.accountId, accountId), eq(insurancePolicies.id, policyId)));
	return policy;
}

export async function createPolicy(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: InsurancePolicyInput
): Promise<{ ok: true; id: string } | { ok: false }> {
	const { accountId } = context;
	const [property] = await db
		.select({ id: properties.id })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return { ok: false };
	await assertQuota(db, accountId, 'insurancePolicies');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(insurancePolicies).values({ id, accountId, propertyId, ...input }),
		auditEntry(db, context, 'insurance_policy', id, 'create', `${policyLabel(input)} angelegt`)
	]);
	return { ok: true, id };
}

export async function updatePolicy(
	db: Database,
	context: AuditContext,
	policyId: string,
	input: InsurancePolicyInput
): Promise<boolean> {
	const { accountId } = context;
	if (!(await getPolicy(db, accountId, policyId))) return false;
	await runBatch(db, [
		db
			.update(insurancePolicies)
			.set(input)
			.where(and(eq(insurancePolicies.accountId, accountId), eq(insurancePolicies.id, policyId))),
		auditEntry(
			db,
			context,
			'insurance_policy',
			policyId,
			'update',
			`${policyLabel(input)} geändert`
		)
	]);
	return true;
}

export async function deletePolicy(
	db: Database,
	context: AuditContext,
	policyId: string
): Promise<boolean> {
	const { accountId } = context;
	const existing = await getPolicy(db, accountId, policyId);
	if (!existing) return false;
	await runBatch(db, [
		db
			.delete(insurancePolicies)
			.where(and(eq(insurancePolicies.accountId, accountId), eq(insurancePolicies.id, policyId))),
		auditEntry(
			db,
			context,
			'insurance_policy',
			policyId,
			'delete',
			`${policyLabel(existing)} gelöscht`
		)
	]);
	return true;
}

/** What /betriebskosten/belege/neu?versicherung=<id>&von=<start> fills in. */
export type InsurancePrefill = {
	insurancePolicyId: string;
	propertyId: string;
	categoryId?: string;
	description: string;
	supplier: string;
	periodStart: string;
	periodEnd: string;
	amount: number;
	allocable: boolean;
};

/**
 * The Beleg of one insurance year (the one starting on `start`, cut at the end of cover). The
 * category is the account's Sach- und Haftpflichtversicherung (§ 2 Nr. 13 BetrKV) for the
 * allocable kinds. Undefined when the policy is not the account's or no year starts on `start`.
 */
export async function insurancePrefill(
	db: Database,
	accountId: string,
	policyId: string,
	start: string
): Promise<InsurancePrefill | undefined> {
	const policy = await getPolicy(db, accountId, policyId);
	if (!policy) return undefined;
	const range = insuranceYearsFor(policy, [Number(start.slice(0, 4))]).find(
		(candidate) => candidate.start === start
	);
	if (!range) return undefined;
	const allocable = allocableInsuranceKinds.includes(policy.kind);
	const [category] = allocable
		? await db
				.select({ id: costCategories.id })
				.from(costCategories)
				.where(and(eq(costCategories.accountId, accountId), eq(costCategories.betrkvItem, 13)))
		: [];
	return {
		insurancePolicyId: policy.id,
		propertyId: policy.propertyId,
		categoryId: category?.id,
		description: `${insuranceKindLabels[policy.kind]} ${formatDate(range.start)} bis ${formatDate(range.end)}`,
		supplier: policy.insurer,
		periodStart: range.start,
		periodEnd: range.end,
		amount: premiumFor(policy.annualPremium, range),
		allocable
	};
}

/**
 * Marks a new Beleg as the one taken over from the policy (the hidden field of the prefilled
 * form). Ignored unless policy and Beleg are the account's and belong to the same property.
 */
export async function linkCostItemToPolicy(
	db: Database,
	accountId: string,
	costItemId: string,
	policyId: string
): Promise<void> {
	const policy = await getPolicy(db, accountId, policyId);
	if (!policy) return;
	await db
		.update(costItems)
		.set({ insurancePolicyId: policy.id })
		.where(
			and(
				eq(costItems.accountId, accountId),
				eq(costItems.id, costItemId),
				eq(costItems.propertyId, policy.propertyId)
			)
		);
}
