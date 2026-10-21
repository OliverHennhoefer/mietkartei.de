import { and, asc, count, eq } from 'drizzle-orm';
import { formatIban } from '../../domain/bank-matching';
import type { BankAccountInput } from '../../forms/bank';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import { bankAccounts, bankTransactions } from '../db/schema';
import { assertQuota } from '../quotas';

// Bankverbindungen: the landlord's accounts rent comes in on. Owners only (the pages enforce it).

export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankAccountSummary = BankAccount & { transactionCount: number };

/** All bank accounts of the account by name, each with the number of transactions imported. */
export async function listBankAccounts(
	db: Database,
	accountId: string
): Promise<BankAccountSummary[]> {
	const rows = await db
		.select({ account: bankAccounts, transactionCount: count(bankTransactions.id) })
		.from(bankAccounts)
		.leftJoin(bankTransactions, eq(bankTransactions.bankAccountId, bankAccounts.id))
		.where(eq(bankAccounts.accountId, accountId))
		.groupBy(bankAccounts.id)
		.orderBy(asc(bankAccounts.name));
	return rows.map((row) => ({ ...row.account, transactionCount: row.transactionCount }));
}

export async function getBankAccount(
	db: Database,
	accountId: string,
	bankAccountId: string
): Promise<BankAccount | undefined> {
	const [row] = await db
		.select()
		.from(bankAccounts)
		.where(and(eq(bankAccounts.accountId, accountId), eq(bankAccounts.id, bankAccountId)));
	return row;
}

/**
 * Refused when the account already has a bank account with this IBAN: transactions are unique
 * only per bank account, so the same statement imported into both would book every rent twice.
 */
export async function createBankAccount(
	db: Database,
	context: AuditContext,
	input: BankAccountInput
): Promise<{ ok: true; id: string } | { ok: false; reason: 'duplicate' }> {
	await assertQuota(db, context.accountId, 'bankAccounts');
	const [existing] = await db
		.select({ id: bankAccounts.id })
		.from(bankAccounts)
		.where(and(eq(bankAccounts.accountId, context.accountId), eq(bankAccounts.iban, input.iban)));
	if (existing) return { ok: false, reason: 'duplicate' };
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(bankAccounts).values({ id, accountId: context.accountId, ...input }),
		auditEntry(
			db,
			context,
			'bankAccount',
			id,
			'create',
			`Bankverbindung „${input.name}“ (${formatIban(input.iban)}) angelegt`
		)
	]);
	return { ok: true, id };
}

/**
 * Deletes the bank account with its imports and transactions (cascade). Refused while a
 * transaction is assigned, because the payments on the ledger would lose their origin.
 */
export async function deleteBankAccount(
	db: Database,
	context: AuditContext,
	bankAccountId: string
): Promise<'deleted' | 'in-use' | 'missing'> {
	const existing = await getBankAccount(db, context.accountId, bankAccountId);
	if (!existing) return 'missing';
	const [matched] = await db
		.select({ value: count() })
		.from(bankTransactions)
		.where(
			and(
				eq(bankTransactions.accountId, context.accountId),
				eq(bankTransactions.bankAccountId, bankAccountId),
				eq(bankTransactions.status, 'matched')
			)
		);
	if (matched.value > 0) return 'in-use';
	await runBatch(db, [
		db
			.delete(bankAccounts)
			.where(
				and(eq(bankAccounts.accountId, context.accountId), eq(bankAccounts.id, bankAccountId))
			),
		auditEntry(
			db,
			context,
			'bankAccount',
			bankAccountId,
			'delete',
			`Bankverbindung „${existing.name}“ (${formatIban(existing.iban)}) gelöscht`
		)
	]);
	return 'deleted';
}
