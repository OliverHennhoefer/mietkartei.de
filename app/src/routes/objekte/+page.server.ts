import { today } from '#lib/dates.ts';
import { project } from '#lib/map/projection.ts';
import { locatePostalCode } from '#lib/server/postal-codes.ts';
import { showsPropertyMaps } from '#lib/server/preferences.ts';
import { propertyOverview } from '#lib/server/properties.ts';
import { requireAccount, requireUser } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// The current properties with their counts; the archived (sold) ones apart, below the list. Each
// current property gets its place on the map from its postal code, unless the user hid the maps.
export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const [all, showMaps] = await Promise.all([
		propertyOverview(locals.db, requireAccount(locals), today()),
		showsPropertyMaps(locals.db, user.id)
	]);
	return {
		showMaps,
		properties: all
			.filter((property) => !property.archivedAt)
			.map((property) => {
				const location = showMaps ? locatePostalCode(property.postalCode) : null;
				const position = location ? project(location.lat, location.lon) : null;
				return { ...property, position: position && position.map((value) => Math.round(value)) };
			}),
		archived: all.filter((property) => property.archivedAt)
	};
};
