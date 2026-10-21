import { error } from '@sveltejs/kit';
import { getLease, leaseLabel } from '#lib/server/leases.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { LayoutServerLoad } from './$types';

// Loads the lease once for every page under /vertraege/[id]; child pages read it from the layout
// data (data.lease). The label is computed here because leases.ts is a server module.
export const load: LayoutServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const lease = await getLease(locals.db, accountId, params.id);
	if (!lease) error(404, 'Diesen Mietvertrag gibt es nicht.');
	return { lease, leaseLabel: leaseLabel(lease) };
};
