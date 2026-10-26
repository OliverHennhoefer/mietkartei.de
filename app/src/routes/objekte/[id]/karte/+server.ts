import { error } from '@sveltejs/kit';
import { mapCenter, PREVIEW, previewVersion } from '#lib/server/map/preview.ts';
import { renderPreview } from '#lib/server/map/render.ts';
import { getStreetMap } from '#lib/server/map/tiles.ts';
import { getProperty } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// The small street map of a property as an SVG image, drawn from the vector tiles of the street
// map. The list links it with the version of everything it depends on (?v=), so the browser keeps
// it for a week and asks again only when the map or the position changed.
export const GET: RequestHandler = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const property = await getProperty(locals.db, accountId, params.id);
	if (!property) error(404, 'Dieses Objekt gibt es nicht.');
	const map = await getStreetMap();
	const center = mapCenter(property);
	if (!map || !center) error(404, 'Für dieses Objekt gibt es keine Karte.');
	const header = await map.tiles.getHeader();
	const svg = await renderPreview(
		async (z, x, y) => {
			const tile = await map.tiles.getZxy(z, x, y);
			return tile ? new Uint8Array(tile.data) : undefined;
		},
		{ ...center, ...PREVIEW, maxDataZoom: header.maxZoom }
	);
	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml; charset=utf-8',
			'Cache-Control': 'private, max-age=604800',
			ETag: `"${previewVersion(center, map.version)}"`,
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
		}
	});
};
