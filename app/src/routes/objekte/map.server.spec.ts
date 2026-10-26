import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { properties, users } from '#lib/server/db/schema.ts';
import { encodeTile, fixtureQuarter, writeArchive } from '#lib/server/map/fixture.ts';
import { worldPixel } from '#lib/server/map/render.ts';
import { resetStreetMap } from '#lib/server/map/tiles.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { GET } from './[id]/karte/+server';
import { GET as getTile } from './karte/[z]/[x]/[y]/+server';
import { load } from './+page.server';

// The street maps of the property list: the link of each property's image, and the image.

const env = vi.hoisted(() => ({ MAP_TILES_PATH: '', GEOCODER_URL: 'off' }));
vi.mock('$app/env/private', () => env);

const directory = mkdtempSync(path.join(tmpdir(), 'mietkartei-karte-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const lat = 52.5321;
const lon = 13.3849;

function writeMap() {
	const tiles: Record<string, Uint8Array> = {};
	const [x, y] = worldPixel(lat, lon, 14).map((value) => Math.floor(value / 256));
	tiles[`14/${x}/${y}`] = encodeTile(fixtureQuarter(x, y));
	const file = path.join(directory, 'map.pmtiles');
	writeFileSync(file, writeArchive(tiles));
	return file;
}

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	env.MAP_TILES_PATH = '';
	resetStreetMap();
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
});

async function place() {
	await db
		.update(properties)
		.set({ latitude: lat, longitude: lon, geocodedAddress: 'Lindenstraße 4, 10115 Berlin' })
		.where(eq(properties.id, propertyId));
}

async function image() {
	try {
		return await GET(routeEvent(db, { params: { id: propertyId } }));
	} catch (error) {
		return error as { status: number };
	}
}

describe('street maps of the property list', () => {
	it('links no image without a street map, and the outline map still places the property', async () => {
		const result = await outcome(() => load(routeEvent(db, {})));
		expect(result).toMatchObject({
			data: { showMaps: true, properties: [{ mapImage: null, position: expect.any(Array) }] }
		});
		expect(await image()).toMatchObject({ status: 404 });
	});

	it('links the image with the version of the map and the position', async () => {
		env.MAP_TILES_PATH = writeMap();
		const before = await outcome(() => load(routeEvent(db, {})));
		const link = (before as { data: { properties: { mapImage: string }[] } }).data.properties[0]
			.mapImage;
		expect(link).toMatch(new RegExp(`^/objekte/${propertyId}/karte\\?v=.+-13\\.5$`));
		await place();
		const after = await outcome(() => load(routeEvent(db, {})));
		expect(after).toMatchObject({
			data: {
				streetMap: expect.stringMatching(/^\d+-\d+$/),
				properties: [
					{
						mapImage: expect.stringMatching(/-52\.53210-13\.38490-15\.5$/),
						location: { lat, lon }
					}
				]
			}
		});
	});

	it('draws the image of a placed property for its own account only', async () => {
		env.MAP_TILES_PATH = writeMap();
		await place();
		const response = (await image()) as Response;
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
		expect(response.headers.get('Cache-Control')).toBe('private, max-age=604800');
		expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
		const svg = await response.text();
		expect(svg).toContain('<path');
		expect(svg).toContain('#f5ff00');
		const other = await seedUnit(db, 'b');
		await expect(GET(routeEvent(db, { params: { id: other.propertyId } }))).rejects.toMatchObject({
			status: 404
		});
	});

	it('shows no maps to a user who hid them', async () => {
		env.MAP_TILES_PATH = writeMap();
		await db.update(users).set({ showPropertyMaps: false });
		expect(await outcome(() => load(routeEvent(db, {})))).toMatchObject({
			data: { showMaps: false, properties: [{ mapImage: null, position: null }] }
		});
	});

	it('draws the tiles of the interactive map for signed-in users with an account', async () => {
		const tile = (params: Record<string, string>) =>
			Promise.resolve()
				.then(() => getTile(routeEvent(db, { params })))
				.catch((error: { status: number }) => error);
		const [x, y] = worldPixel(lat, lon, 14).map((value) => Math.floor(value / 256));
		const params = { z: '14', x: String(x), y: String(y) };
		expect(await tile(params)).toMatchObject({ status: 404 });
		env.MAP_TILES_PATH = writeMap();
		resetStreetMap();
		const response = (await tile(params)) as Response;
		expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
		expect(response.headers.get('ETag')).toMatch(new RegExp(`-14-${x}-${y}"$`));
		expect(await response.text()).toContain('<path');
		// Beyond the street map's data, an empty tile.
		const empty = (await tile({ ...params, x: String(x + 5) })) as Response;
		expect(await empty.text()).not.toContain('<path');
		for (const wrong of [
			{ z: '4', x: '0', y: '0' },
			{ z: '18', x: '0', y: '0' },
			{ z: '14', x: '16384', y: '0' },
			{ z: '14', x: '-1', y: '0' },
			{ z: '14', x: '1e3', y: '0' }
		]) {
			expect(await tile(wrong)).toMatchObject({ status: 404 });
		}
		await expect(getTile(routeEvent(db, { params, user: null }))).rejects.toMatchObject({
			status: 303
		});
	});

	it('tells the Rückstand and the rent beside the Zensus average for the interactive map', async () => {
		await seedLease(db, 'a', unitId);
		expect(await outcome(() => load(routeEvent(db, {})))).toMatchObject({
			data: { properties: [{ facts: null }] }
		});
		env.MAP_TILES_PATH = writeMap();
		resetStreetMap();
		expect(await outcome(() => load(routeEvent(db, {})))).toMatchObject({
			data: {
				properties: [
					{
						vacantUnits: 0,
						facts: {
							overdue: expect.any(Number),
							rentPerSquareMetre: Math.round(60000 / 64),
							municipality: { name: expect.stringContaining('Berlin'), rentPerSquareMetre: 767 }
						}
					}
				]
			}
		});
		const [property] = (
			(await outcome(() => load(routeEvent(db, {})))) as {
				data: { properties: { facts: { overdue: number } }[] };
			}
		).data.properties;
		expect(property.facts.overdue).toBeGreaterThan(0);
	});
});
