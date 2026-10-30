import { addMonths, today } from '#lib/dates.ts';
import { listDeadlines } from '#lib/server/deadlines.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// Fristen: the deadlines of the next twelve months, as they follow from the data. Those within two
// weeks also show up as reminders on /aufgaben.
export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	const date = today();
	return {
		today: date,
		deadlines: await listDeadlines(locals.db, accountId, { to: addMonths(date, 12) })
	};
};
