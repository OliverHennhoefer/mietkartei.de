import { eq, inArray } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	accounts,
	allocationKeyShares,
	allocationKeys,
	apiKeys,
	auditLog,
	bankAccounts,
	bankImports,
	bankTransactions,
	billingCircleUnits,
	billingCircles,
	co2CostSplits,
	consumerPriceIndex,
	costCategories,
	costItemUnitAmounts,
	costItems,
	depositTransactions,
	documents,
	emailChanges,
	invitations,
	leasePersons,
	leaseTenants,
	leaseUnits,
	leases,
	loginAttempts,
	matchingRules,
	meterReadings,
	meters,
	operatingCostStatements,
	passwordResets,
	payments,
	properties,
	rentCharges,
	rentChanges,
	sessions,
	statementResults,
	tasks,
	tenants,
	units,
	users
} from './db/schema';
import { accountPrefix, getStorage, type Storage } from './storage';

/**
 * The account that existed before sign-in. The first user to register takes it over, so data
 * entered on an existing self-hosted instance stays available.
 */
export const DEFAULT_ACCOUNT_ID = 'default';

export async function ensureDefaultAccount(db: Database): Promise<string> {
	await db
		.insert(accounts)
		.values({ id: DEFAULT_ACCOUNT_ID, name: 'Standardkonto' })
		.onConflictDoNothing();
	return DEFAULT_ACCOUNT_ID;
}

/** The landlord as sender of letters and statements; falls back to the account name. */
export type LandlordAddress = {
	name: string;
	street: string | null;
	postalCode: string | null;
	city: string | null;
	iban: string | null;
	bankName: string | null;
	/** True when the sender block is usable on a letter (name and postal address present). */
	complete: boolean;
};

export async function landlordAddress(db: Database, accountId: string): Promise<LandlordAddress> {
	const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
	const name = account?.landlordName?.trim() || account?.name || '';
	const street = account?.street ?? null;
	const postalCode = account?.postalCode ?? null;
	const city = account?.city ?? null;
	return {
		name,
		street,
		postalCode,
		city,
		iban: account?.iban ?? null,
		bankName: account?.bankName ?? null,
		complete: Boolean(name && street && postalCode && city)
	};
}

/** The sender as lines for a letter head: name, street, "postal code city". */
export function addressLines(address: LandlordAddress): string[] {
	const lines = [address.name];
	if (address.street) lines.push(address.street);
	if (address.postalCode || address.city)
		lines.push([address.postalCode, address.city].filter(Boolean).join(' '));
	return lines;
}

/**
 * Removes the account with everything in it: first the stored files, then every row in one
 * batch, in dependency order (children before parents, because `restrict` keys would otherwise
 * stop a cascade). Files first, so a storage failure throws with the account still there and the
 * deletion can be tried again; a failed batch leaves the rows, and a retry finishes the job. The
 * files go by their key prefix, not by the rows, so a file a manager stored meanwhile goes too:
 * an upload between the two steps is caught by a second sweep after the batch, and an upload
 * after the batch finds no account and storeDocument removes its file again. Returns false when
 * there is no such account.
 */
export async function deleteAccount(
	db: Database,
	accountId: string,
	options?: { storage?: Storage }
): Promise<boolean> {
	const [account] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(eq(accounts.id, accountId));
	if (!account) return false;

	// No storage given: the default adapter of the target.
	const storage = options?.storage ?? (await getStorage());
	const prefix = accountPrefix(accountId);
	await storage.deletePrefix(prefix);

	const accountLeases = db
		.select({ id: leases.id })
		.from(leases)
		.where(eq(leases.accountId, accountId));
	const accountUsers = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.accountId, accountId));
	const accountEmails = db
		.select({ email: users.email })
		.from(users)
		.where(eq(users.accountId, accountId));

	// Children before parents. Tables with `accountId` are deleted by it; the tables without one
	// go by their parent's ids, the failed sign-ins by the users' addresses.
	const scoped = [
		documents,
		tasks,
		co2CostSplits,
		statementResults,
		operatingCostStatements,
		meterReadings,
		meters,
		costItemUnitAmounts,
		costItems,
		costCategories,
		allocationKeyShares,
		allocationKeys,
		billingCircleUnits,
		billingCircles,
		matchingRules,
		payments,
		depositTransactions,
		rentCharges,
		bankTransactions,
		bankImports,
		bankAccounts,
		rentChanges,
		leasePersons,
		leaseUnits
	];
	await runBatch(db, [
		...scoped.map((table) => db.delete(table).where(eq(table.accountId, accountId))),
		db.delete(leaseTenants).where(inArray(leaseTenants.leaseId, accountLeases)),
		db.delete(leases).where(eq(leases.accountId, accountId)),
		db.delete(tenants).where(eq(tenants.accountId, accountId)),
		db.delete(units).where(eq(units.accountId, accountId)),
		db.delete(properties).where(eq(properties.accountId, accountId)),
		db.delete(consumerPriceIndex).where(eq(consumerPriceIndex.accountId, accountId)),
		db.delete(auditLog).where(eq(auditLog.accountId, accountId)),
		db.delete(invitations).where(eq(invitations.accountId, accountId)),
		db.delete(emailChanges).where(eq(emailChanges.accountId, accountId)),
		db.delete(sessions).where(inArray(sessions.userId, accountUsers)),
		db.delete(apiKeys).where(eq(apiKeys.accountId, accountId)),
		db.delete(passwordResets).where(inArray(passwordResets.userId, accountUsers)),
		db.delete(loginAttempts).where(inArray(loginAttempts.email, accountEmails)),
		db.delete(users).where(eq(users.accountId, accountId)),
		db.delete(accounts).where(eq(accounts.id, accountId))
	]);
	// The account is gone, so a failure here must not report the deletion as failed. Left behind
	// can only be the file of an upload that landed between the two sweeps.
	await storage.deletePrefix(prefix).catch((error: unknown) => {
		console.error('[storage] Files stored while the account was deleted remain:', error);
	});
	return true;
}

/** The landlord sender block as edited under /einstellungen/profil; empty fields are null. */
export type LandlordInput = {
	landlordName: string | null;
	street: string | null;
	postalCode: string | null;
	city: string | null;
	iban: string | null;
	bankName: string | null;
};

/** Sets the sender block of the account, which letters and statements print. */
export async function updateLandlord(
	db: Database,
	context: AuditContext,
	input: LandlordInput
): Promise<void> {
	await runBatch(db, [
		db.update(accounts).set(input).where(eq(accounts.id, context.accountId)),
		auditEntry(
			db,
			context,
			'account',
			context.accountId,
			'update',
			'Absender (Vermieter) für Briefe und Abrechnungen geändert'
		)
	]);
}

/** The sender block as stored, for the form under /einstellungen/profil (no fallbacks). */
export async function getLandlord(db: Database, accountId: string): Promise<LandlordInput> {
	const [account] = await db
		.select({
			landlordName: accounts.landlordName,
			street: accounts.street,
			postalCode: accounts.postalCode,
			city: accounts.city,
			iban: accounts.iban,
			bankName: accounts.bankName
		})
		.from(accounts)
		.where(eq(accounts.id, accountId));
	return (
		account ?? {
			landlordName: null,
			street: null,
			postalCode: null,
			city: null,
			iban: null,
			bankName: null
		}
	);
}
