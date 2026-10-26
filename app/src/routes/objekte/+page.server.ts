import { today } from '#lib/dates.ts';
import { project } from '#lib/map/projection.ts';
import { locateInBackground } from '#lib/server/geocoding.ts';
import { mapCenter, previewVersion } from '#lib/server/map/preview.ts';
import { getStreetMap } from '#lib/server/map/tiles.ts';
import { showsPropertyMaps } from '#lib/server/preferences.ts';
import { propertyOverview } from '#lib/server/properties.ts';
import { requireAccount, requireUser } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// The current properties with their counts; the archived (sold) ones apart, below the list. Unless
// the user hid the maps, each current property comes with its place on the map of Germany and,
// where the street map is set up, the link of its small street map. Properties whose address has
// not been placed yet are placed in the background, for the next visit.
export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const accountId = requireAccount(locals);
	const [all, showMaps] = await Promise.all([
		propertyOverview(locals.db, accountId, today()),
		showsPropertyMaps(locals.db, user.id)
	]);
	const streetMap = showMaps ? await getStreetMap() : null;
	if (showMaps) await locateInBackground(locals.db, accountId);
	return {
		showMaps,
		properties: all
			.filter((property) => !property.archivedAt)
			.map((property) => {
				const center = showMaps ? mapCenter(property) : null;
				const position = center ? project(center.lat, center.lon) : null;
				return {
					...property,
					position: position && position.map((value) => Math.round(value)),
					mapImage:
						center && streetMap
							? `/objekte/${property.id}/karte?v=${previewVersion(center, streetMap.version)}`
							: null
				};
			}),
		archived: all.filter((property) => property.archivedAt)
	};
};
