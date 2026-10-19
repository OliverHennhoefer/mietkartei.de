import type { Handle } from '@sveltejs/kit/hooks';
import { ensureDefaultAccount } from '#lib/server/accounts.ts';
import { getDatabase } from '#lib/server/db/index.ts';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.db = await getDatabase();
	event.locals.accountId = await ensureDefaultAccount(event.locals.db);
	return resolve(event);
};
