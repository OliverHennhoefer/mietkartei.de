import { and, asc, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { matchingFieldLabels, type Rule } from '../../domain/bank-matching';
import type { RuleInput } from '../../forms/bank';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import { leases, matchingRules } from '../db/schema';
import { assertQuota } from '../quotas';

// Zuordnungsregeln: "transactions whose <field> contains <pattern> belong to this lease". They
// apply in creation order, first match wins; only confirmed rules assign on import.

export type MatchingRule = typeof matchingRules.$inferSelect;

/** The rules of the account in creation order, the order they apply in. */
export async function listRules(db: Database, accountId: string): Promise<MatchingRule[]> {
	return db
		.select()
		.from(matchingRules)
		.where(eq(matchingRules.accountId, accountId))
		.orderBy(asc(matchingRules.createdAt), sql`rowid`);
}

/** The confirmed rules in creation order, as the matcher takes them. */
export async function listConfirmedRules(db: Database, accountId: string): Promise<Rule[]> {
	return (await listRules(db, accountId)).filter((rule) => rule.confirmed);
}

function ruleSummary(rule: RuleInput, verb: string): string {
	return `Zuordnungsregel „${matchingFieldLabels[rule.field]} enthält ${rule.pattern}“ ${verb}`;
}

/** The insert statements for a rule an assignment remembers, for the assignment batch. */
export function ruleEntry(
	db: Database,
	context: AuditContext,
	input: RuleInput
): { id: string; statements: BatchItem<'sqlite'>[] } {
	const id = crypto.randomUUID();
	return {
		id,
		statements: [
			db.insert(matchingRules).values({ id, accountId: context.accountId, ...input }),
			auditEntry(db, context, 'matchingRule', id, 'create', ruleSummary(input, 'angelegt'))
		]
	};
}

/**
 * The statements that turn confirmed rules back into suggestions, for the assignment batch: the
 * landlord assigned a transaction they match to another lease.
 */
export function unconfirmEntries(
	db: Database,
	context: AuditContext,
	rules: readonly MatchingRule[]
): BatchItem<'sqlite'>[] {
	return rules.flatMap((rule) => [
		db
			.update(matchingRules)
			.set({ confirmed: false })
			.where(and(eq(matchingRules.accountId, context.accountId), eq(matchingRules.id, rule.id))),
		auditEntry(
			db,
			context,
			'matchingRule',
			rule.id,
			'update',
			ruleSummary(
				rule,
				'wieder zum Vorschlag gemacht, weil ein Umsatz einem anderen Mietvertrag zugeordnet wurde'
			)
		)
	]);
}

/** Creates a rule for a lease of the account; `confirmed` decides whether it assigns on import. */
export async function createRule(
	db: Database,
	context: AuditContext,
	input: RuleInput
): Promise<{ ok: true; id: string } | { ok: false; reason: 'unknown-lease' }> {
	await assertQuota(db, context.accountId, 'matchingRules');
	const [lease] = await db
		.select({ id: leases.id })
		.from(leases)
		.where(and(eq(leases.accountId, context.accountId), eq(leases.id, input.leaseId)));
	if (!lease) return { ok: false, reason: 'unknown-lease' };
	const entry = ruleEntry(db, context, input);
	await runBatch(db, entry.statements);
	return { ok: true, id: entry.id };
}

async function getRule(db: Database, accountId: string, ruleId: string) {
	const [rule] = await db
		.select()
		.from(matchingRules)
		.where(and(eq(matchingRules.accountId, accountId), eq(matchingRules.id, ruleId)));
	return rule;
}

/** Turns a suggestion into a rule that assigns on import. False when the rule is not in the account. */
export async function confirmRule(
	db: Database,
	context: AuditContext,
	ruleId: string
): Promise<boolean> {
	const rule = await getRule(db, context.accountId, ruleId);
	if (!rule) return false;
	if (rule.confirmed) return true;
	await runBatch(db, [
		db
			.update(matchingRules)
			.set({ confirmed: true })
			.where(and(eq(matchingRules.accountId, context.accountId), eq(matchingRules.id, ruleId))),
		auditEntry(db, context, 'matchingRule', ruleId, 'approve', ruleSummary(rule, 'bestätigt'))
	]);
	return true;
}

/** Changes a rule's lease, field, text and whether it assigns on import. */
export async function updateRule(
	db: Database,
	context: AuditContext,
	ruleId: string,
	input: RuleInput
): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'unknown-lease' }> {
	if (!(await getRule(db, context.accountId, ruleId))) return { ok: false, reason: 'missing' };
	const [lease] = await db
		.select({ id: leases.id })
		.from(leases)
		.where(and(eq(leases.accountId, context.accountId), eq(leases.id, input.leaseId)));
	if (!lease) return { ok: false, reason: 'unknown-lease' };
	await runBatch(db, [
		db
			.update(matchingRules)
			.set(input)
			.where(and(eq(matchingRules.accountId, context.accountId), eq(matchingRules.id, ruleId))),
		auditEntry(db, context, 'matchingRule', ruleId, 'update', ruleSummary(input, 'geändert'))
	]);
	return { ok: true };
}

export async function deleteRule(
	db: Database,
	context: AuditContext,
	ruleId: string
): Promise<boolean> {
	const rule = await getRule(db, context.accountId, ruleId);
	if (!rule) return false;
	await runBatch(db, [
		db
			.delete(matchingRules)
			.where(and(eq(matchingRules.accountId, context.accountId), eq(matchingRules.id, ruleId))),
		auditEntry(db, context, 'matchingRule', ruleId, 'delete', ruleSummary(rule, 'gelöscht'))
	]);
	return true;
}
