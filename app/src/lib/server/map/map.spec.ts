import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PMTiles } from 'pmtiles';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTile, fixtureQuarter, writeArchive } from './fixture.ts';
import { mapCenter, previewVersion } from './preview.ts';
import { renderPreview, worldPixel, type TileReader } from './render.ts';
import { getStreetMap, partedSource, partRanges, resetStreetMap } from './tiles.ts';

// The street map: reading the archive from its parts, drawing a view of it, and where the view
// of a property lies. The archive is the made-up quarter of fixture.ts.

const env = vi.hoisted(() => ({ MAP_TILES_PATH: '' }));
vi.mock('$app/env/private', () => env);

const directory = mkdtempSync(path.join(tmpdir(), 'mietkartei-map-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

// Kreuzberg, in the middle of a tile at zoom 14.
const lat = 52.4986;
const lon = 13.4033;

function archiveAround(zoom: number) {
	const [x, y] = worldPixel(lat, lon, zoom).map((value) => Math.floor(value / 256));
	const tiles: Record<string, Uint8Array> = {};
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			tiles[`${zoom}/${x + dx}/${y + dy}`] = encodeTile(fixtureQuarter(x + dx, y + dy));
		}
	}
	return writeArchive(tiles);
}

const archive = archiveAround(14);

function reader(tiles: PMTiles): TileReader {
	return async (z, x, y) => {
		const tile = await tiles.getZxy(z, x, y);
		return tile ? new Uint8Array(tile.data) : undefined;
	};
}

describe('parted archive', () => {
	const manifest = { version: 'v1', size: 25, partSize: 10, parts: ['p0', 'p1', 'p2'] };

	it('splits a byte range across the parts', () => {
		expect(partRanges(manifest, 8, 5)).toEqual([
			{ part: 'p0', offset: 8, length: 2 },
			{ part: 'p1', offset: 0, length: 3 }
		]);
		expect(partRanges(manifest, 18, 100)).toEqual([
			{ part: 'p1', offset: 8, length: 2 },
			{ part: 'p2', offset: 0, length: 5 }
		]);
		expect(partRanges(manifest, 30, 4)).toEqual([]);
	});

	it('reads the archive from parts as from one file', async () => {
		const partSize = 4000;
		const parts = Array.from({ length: Math.ceil(archive.length / partSize) }, (_, i) => `p${i}`);
		const read = vi.fn(async (part: string, offset: number, length: number) => {
			const start = parts.indexOf(part) * partSize + offset;
			return archive.slice(start, start + length);
		});
		const source = partedSource({ version: 'v2', size: archive.length, partSize, parts }, read);
		expect(source.getKey()).toBe('map:v2');
		const tiles = new PMTiles(source);
		expect((await tiles.getHeader()).maxZoom).toBe(14);
		const [x, y] = worldPixel(lat, lon, 14).map((value) => Math.floor(value / 256));
		const tile = await tiles.getZxy(14, x, y);
		expect(tile?.data.byteLength).toBe(encodeTile(fixtureQuarter(x, y)).length);
		expect(new Set(read.mock.calls.map(([part]) => part)).size).toBeGreaterThan(1);
	});
});

describe('getStreetMap on node', () => {
	beforeEach(() => resetStreetMap());

	it('has no map without MAP_TILES_PATH and opens the file it names', async () => {
		env.MAP_TILES_PATH = '';
		expect(await getStreetMap()).toBeNull();
		resetStreetMap();
		const file = path.join(directory, 'map.pmtiles');
		writeFileSync(file, archive);
		env.MAP_TILES_PATH = file;
		const map = await getStreetMap(1000);
		expect(map?.version).toMatch(new RegExp(`^${archive.length}-`));
		expect((await map!.tiles.getHeader()).maxZoom).toBe(14);
		// Kept for ten minutes, then opened again.
		expect(await getStreetMap(1000 + 60_000)).toBe(map);
		expect(await getStreetMap(1000 + 11 * 60_000)).not.toBe(map);
	});

	it('has no map when the file cannot be opened', async () => {
		env.MAP_TILES_PATH = path.join(directory, 'missing.pmtiles');
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await getStreetMap()).toBeNull();
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});

describe('renderPreview', () => {
	const tiles = new PMTiles(
		partedSource(
			{ version: 'v', size: archive.length, partSize: archive.length, parts: ['all'] },
			async (_, offset, length) => archive.slice(offset, offset + length)
		)
	);
	const view = { lat, lon, width: 480, height: 240, maxDataZoom: 14 };

	it('draws land, park, water, buildings and roads with the property in the middle', async () => {
		const svg = await renderPreview(reader(tiles), { ...view, zoom: 15.5 });
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 480 240"/);
		expect(svg).toContain('fill="#222"');
		expect(svg).toContain('fill="#2e2e2e"');
		expect(svg).toContain('<circle cx="240" cy="120" r="6" fill="#f5ff00"');
		// Scaled up from zoom 14, so the roads are wider than at zoom 14 itself.
		expect(svg).toMatch(/stroke="#424242" stroke-width="2\.24"/);
		// Only what lies in the view, in pixels with at most one decimal.
		const numbers = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [+x, +y]);
		expect(numbers.length).toBeGreaterThan(50);
		expect(numbers.every(([x]) => x > -2000 && x < 2500)).toBe(true);
		expect(svg).not.toMatch(/[ML ]-?\d+\.\d{2}/);
	});

	it('leaves missing and broken tiles empty', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const nothing = await renderPreview(async () => undefined, { ...view, zoom: 14 });
		expect(nothing).not.toContain('<path');
		expect(nothing).toContain('#f5ff00');
		const broken = await renderPreview(async () => Uint8Array.from([0xff, 0xff, 0xff]), {
			...view,
			zoom: 14
		});
		expect(broken).not.toContain('<path');
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it('leaves out other land use, water lines and keeps unknown roads as minor ones', async () => {
		const tile = encodeTile([
			{
				name: 'landuse',
				features: [
					{
						type: 'polygon',
						properties: { kind: 'industrial' },
						geometry: [
							[
								[0, 0],
								[4096, 0],
								[4096, 4096],
								[0, 0]
							]
						]
					}
				]
			},
			{
				name: 'water',
				features: [
					{
						type: 'line',
						properties: { kind: 'stream' },
						geometry: [
							[
								[0, 0],
								[4096, 4096]
							]
						]
					}
				]
			},
			{
				name: 'roads',
				features: [
					{
						type: 'line',
						properties: { kind: 'ferry' },
						geometry: [
							[
								[0, 2048],
								[4096, 2048]
							]
						]
					}
				]
			},
			{ name: 'pois', features: [] }
		]);
		const svg = await renderPreview(async () => tile, { ...view, zoom: 14 });
		expect(svg).not.toContain('fill="#272727"');
		expect(svg).not.toContain('fill="#141414" d=');
		expect(svg).toContain('stroke="#363636"');
	});
});

describe('mapCenter', () => {
	const address = { street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' };

	it('zooms in on a position found for the current address', () => {
		const placed = {
			...address,
			latitude: 52.5,
			longitude: 13.4,
			geocodedAddress: 'Lindenstraße 4, 10115 Berlin'
		};
		expect(mapCenter(placed)).toEqual({ lat: 52.5, lon: 13.4, zoom: 15.5, exact: true });
		expect(previewVersion(mapCenter(placed)!, 'v')).toBe('v-52.50000-13.40000-15.5');
	});

	it('shows the postal code area until then, and nothing for an unknown code', () => {
		const changed = {
			...address,
			latitude: 52.5,
			longitude: 13.4,
			geocodedAddress: 'Alt 1, 10115 Berlin'
		};
		expect(mapCenter(changed)).toMatchObject({ zoom: 13.5, exact: false });
		const notFound = { ...address, latitude: null, longitude: null, geocodedAddress: 'x' };
		expect(mapCenter(notFound)?.lat).toBeCloseTo(52.53, 1);
		expect(mapCenter({ ...notFound, postalCode: '00000' })).toBeNull();
	});
});
