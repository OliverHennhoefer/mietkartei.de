import { error } from '@sveltejs/kit';
import { TILE_ZOOMS } from '#lib/map/street-map.ts';
import { renderTile } from '#lib/server/map/render.ts';
import { getStreetMap } from '#lib/server/map/tiles.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// One tile of the interactive map on the property list, as an SVG image drawn from the vector
// tiles of the street map. The map links each with the version of the street map (?v=), so the
// browser keeps it for a week and asks again only after a new upload. Only signed-in users with
// an account see the map, like the properties on it.
export const GET: RequestHandler = async ({ locals, params }) => {
	requireAccount(locals);
	const [z, x, y] = [params.z, params.x, params.y].map((value) =>
		/^\d{1,6}$/.test(value) ? Number(value) : NaN
	);
	if (!(z >= TILE_ZOOMS.min && z <= TILE_ZOOMS.max && x < 2 ** z && y < 2 ** z)) {
		error(404, 'Diese Kachel gibt es nicht.');
	}
	const map = await getStreetMap();
	if (!map) error(404, 'Es ist keine Straßenkarte eingerichtet.');
	const header = await map.tiles.getHeader();
	const svg = await renderTile(
		async (tz, tx, ty) => {
			const tile = await map.tiles.getZxy(tz, tx, ty);
			return tile ? new Uint8Array(tile.data) : undefined;
		},
		z,
		x,
		y,
		header.maxZoom
	);
	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml; charset=utf-8',
			'Cache-Control': 'private, max-age=604800',
			ETag: `"${map.version}-${z}-${x}-${y}"`,
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
		}
	});
};
