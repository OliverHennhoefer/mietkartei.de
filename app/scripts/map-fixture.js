// Writes a made-up street map for the end-to-end tests and screenshots: the quarters of
// src/lib/server/map/fixture.ts around the postal codes the tests and the demo data use, from
// zoom 5 to 14 with the names of their places, as a PMTiles archive, and next to it the manifest
// under which the cloudflare target finds it in R2 as a single part. Usage: node scripts/map-fixture.js <archive> [postal codes …]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeTile, fixtureQuarter, writeArchive } from '../src/lib/server/map/fixture.ts';
import { locatePostalCode } from '../src/lib/server/postal-codes.ts';
import { worldPixel } from '../src/lib/server/map/render.ts';

const [target, ...extra] = process.argv.slice(2);
if (!target) throw new Error('Usage: node scripts/map-fixture.js <archive> [postal codes …]');
/** The postal codes with the names the tiles of the interactive map show. */
const places = {
	10115: 'Berlin',
	10969: 'Kreuzberg',
	14469: 'Potsdam',
	81669: 'München',
	20457: 'Hamburg',
	50667: 'Köln',
	'04107': 'Leipzig'
};
const codes = [...Object.keys(places), ...extra];

/** @type {Record<string, Uint8Array>} */
const tiles = {};
for (const code of codes) {
	const position = locatePostalCode(code);
	if (!position) continue;
	for (let zoom = 5; zoom <= 14; zoom++) {
		const pixel = worldPixel(position.lat, position.lon, zoom);
		const [px, py] = pixel.map((value) => Math.floor(value / 256));
		/** @type {[number, number]} */
		const at = [Math.round((pixel[0] / 256 - px) * 4096), Math.round((pixel[1] / 256 - py) * 4096)];
		const name = places[/** @type {keyof typeof places} */ (code)];
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const place = dx === 0 && dy === 0 && name ? { name, at } : undefined;
				tiles[`${zoom}/${px + dx}/${py + dy}`] ??= encodeTile(
					fixtureQuarter(px + dx, py + dy, place)
				);
			}
		}
	}
}
const archive = writeArchive(tiles);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, archive);
writeFileSync(
	`${target}.manifest.json`,
	JSON.stringify({
		version: 'fixture',
		size: archive.length,
		partSize: archive.length,
		parts: ['map/fixture.pmtiles']
	})
);
console.log(`${target}: ${Object.keys(tiles).length} tiles, ${archive.length} bytes`);
