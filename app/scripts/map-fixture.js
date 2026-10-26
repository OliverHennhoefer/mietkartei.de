// Writes a made-up street map for the end-to-end tests and screenshots: the quarters of
// src/lib/server/map/fixture.ts around the postal codes the tests and the demo data use, as a
// PMTiles archive, and next to it the manifest under which the cloudflare target finds it in R2
// as a single part. Usage: node scripts/map-fixture.js <archive> [postal codes …]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeTile, fixtureQuarter, writeArchive } from '../src/lib/server/map/fixture.ts';
import { locatePostalCode } from '../src/lib/server/postal-codes.ts';
import { worldPixel } from '../src/lib/server/map/render.ts';

const [target, ...extra] = process.argv.slice(2);
if (!target) throw new Error('Usage: node scripts/map-fixture.js <archive> [postal codes …]');
const codes = ['10115', '10969', '14469', '81669', '20457', '50667', '04107', ...extra];

/** @type {Record<string, Uint8Array>} */
const tiles = {};
for (const code of codes) {
	const position = locatePostalCode(code);
	if (!position) continue;
	for (const zoom of [13, 14]) {
		const [px, py] = worldPixel(position.lat, position.lon, zoom).map((value) =>
			Math.floor(value / 256)
		);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				tiles[`${zoom}/${px + dx}/${py + dy}`] ??= encodeTile(fixtureQuarter(px + dx, py + dy));
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
