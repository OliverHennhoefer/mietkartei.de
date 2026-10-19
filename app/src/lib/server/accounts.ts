import type { Database } from './db';
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
