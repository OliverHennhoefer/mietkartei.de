import { error } from '@sveltejs/kit';
import { getProperty } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { LayoutServerLoad } from './$types';

// Loads the property once for every page under /objekte/[id]; child pages read it from the layout
// data (data.property) or load it again when they need it in an action.
export const load: LayoutServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const property = await getProperty(locals.db, accountId, params.id);
	if (!property) error(404, 'Dieses Objekt gibt es nicht.');
	return { property };
};
