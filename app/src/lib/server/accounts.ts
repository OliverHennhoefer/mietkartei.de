import { eq, inArray } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import {
	accounts,
	allocationKeyShares,
	allocationKeys,
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
	invitations,
	leasePersons,
	leaseTenants,
	leaseUnits,
	leases,
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
import { deleteAllDocuments } from './documents';
import type { Storage } from './storage';

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
 * Removes the account with everything in it: documents and their files first, then every row in
 * dependency order (children before parents, because `restrict` keys would otherwise stop a
 * cascade), then the users and the account itself. The rows go in one batch, so a failure leaves
 * the account complete except for the files already removed. Returns the number of documents
 * deleted, or `undefined` when there is no such account.
 */
export async function deleteAccount(
	db: Database,
	accountId: string,
	options?: { storage?: Storage }
): Promise<number | undefined> {
	const [account] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(eq(accounts.id, accountId));
	if (!account) return undefined;

	const documentCount = await deleteAllDocuments(db, accountId, options);

	const accountLeases = db
		.select({ id: leases.id })
		.from(leases)
		.where(eq(leases.accountId, accountId));
	const accountUsers = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.accountId, accountId));

	// Children before parents. Tables with `accountId` are deleted by it; the two join tables
	// without one go by their parent's ids.
	const scoped = [
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
		db.delete(sessions).where(inArray(sessions.userId, accountUsers)),
		db.delete(passwordResets).where(inArray(passwordResets.userId, accountUsers)),
		db.delete(users).where(eq(users.accountId, accountId)),
		db.delete(accounts).where(eq(accounts.id, accountId))
	]);
	return documentCount;
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
