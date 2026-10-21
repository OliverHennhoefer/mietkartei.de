import { eq } from 'drizzle-orm';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { runBatch } from './db/batch';
import { accounts } from './db/schema';

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

/** The landlord as sender of letters; falls back to the account name. */
export type LandlordAddress = {
	name: string;
	street: string | null;
	postalCode: string | null;
	city: string | null;
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

/** The landlord sender block as edited under /einstellungen/profil; empty fields are null. */
export type LandlordInput = {
	landlordName: string | null;
	street: string | null;
	postalCode: string | null;
	city: string | null;
};

/** Sets the sender block of the account, which letters print. */
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
			'Absender (Vermieter) für Briefe geändert'
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
			city: accounts.city
		})
		.from(accounts)
		.where(eq(accounts.id, accountId));
	return account ?? { landlordName: null, street: null, postalCode: null, city: null };
}
