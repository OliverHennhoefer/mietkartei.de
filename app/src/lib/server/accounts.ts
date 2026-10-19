import type { Database } from './db';
import { accounts } from './db/schema';

/**
 * Until sign-in exists, every request uses this single account. Data is already stored per
 * account, so adding sign-in later only changes how the account of a request is determined.
 */
export const DEFAULT_ACCOUNT_ID = 'default';

// One check per process or Worker isolate is enough; afterwards the row exists.
let ensured = false;

export async function ensureDefaultAccount(db: Database): Promise<string> {
	if (!ensured) {
		await db
			.insert(accounts)
			.values({ id: DEFAULT_ACCOUNT_ID, name: 'Standardkonto' })
			.onConflictDoNothing();
		ensured = true;
	}
	return DEFAULT_ACCOUNT_ID;
}
