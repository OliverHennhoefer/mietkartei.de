import { listAuditEntities, listAuditLog, listAuditLogForEntity } from '#lib/server/audit.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

/** The newest 200 entries of the account's log, optionally narrowed to one entity (?entity=). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	// Entity names are short; a longer value is ignored instead of being queried.
	const requested = url.searchParams.get('entity')?.trim() || '';
	const entity = requested.length <= 50 ? requested : '';
	const [entries, entities] = await Promise.all([
		entity
			? listAuditLogForEntity(locals.db, accountId, entity, LIMIT)
			: listAuditLog(locals.db, accountId, LIMIT),
		listAuditEntities(locals.db, accountId)
	]);
	return { entries, entities, entity, limit: LIMIT };
};
