import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './db/index.ts';
import { properties } from './db/schema.ts';
import {
	addressKey,
	geocode,
	geocodingEnabled,
	locateInBackground,
	locateProperties,
	propertiesToLocate
} from './geocoding.ts';
import { seedUnit, testDatabase } from './testing.ts';

// Placing the properties by their address: the geocoder is a fake fetch, so no test asks
// Nominatim.

const env = vi.hoisted(() => ({ GEOCODER_URL: 'https://geocoder.example/search' }));
vi.mock('$app/env/private', () => env);
const streetMap = vi.hoisted(() => ({ map: {} as object | null }));
vi.mock('./map/tiles.ts', () => ({ getStreetMap: async () => streetMap.map }));

let db: Database;
let propertyId: string;

beforeEach(async () => {
	env.GEOCODER_URL = 'https://geocoder.example/search';
	streetMap.map = {};
	db = await testDatabase();
	({ propertyId } = await seedUnit(db, 'a'));
});

/** A geocoder that answers each request with the next of the answers. */
function geocoder(...answers: (Response | Error)[]) {
	return vi.fn<typeof fetch>(async () => {
		const answer = answers.shift() ?? Response.json([]);
		if (answer instanceof Error) throw answer;
		return answer;
	});
}

const hit = (lat: string, lon: string) => Response.json([{ lat, lon }]);

async function stored(id = propertyId) {
	const [row] = await db
		.select({
			latitude: properties.latitude,
			longitude: properties.longitude,
			geocodedAddress: properties.geocodedAddress
		})
		.from(properties)
		.where(eq(properties.id, id));
	return row;
}

describe('geocode', () => {
	it('asks for the structured address in Germany and reads the first hit', async () => {
		const fetcher = geocoder(hit('52.5321', '13.3849'));
		const address = { street: ' Lindenstraße 4 ', postalCode: '10115', city: 'Berlin ' };
		expect(await geocode(address, fetcher)).toEqual({ lat: 52.5321, lon: 13.3849 });
		const [url, init] = fetcher.mock.calls[0];
		expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({
			street: 'Lindenstraße 4',
			postalcode: '10115',
			city: 'Berlin',
			countrycodes: 'de',
			format: 'jsonv2',
			limit: '1'
		});
		expect(String(url)).toMatch(/^https:\/\/geocoder\.example\/search\?/);
		expect(init?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('mietkartei') });
		expect(addressKey(address)).toBe('Lindenstraße 4, 10115 Berlin');
	});

	it('knows no position without a usable hit and throws when it cannot ask', async () => {
		const address = { street: 'Nirgends 1', postalCode: '10115', city: 'Berlin' };
		expect(await geocode(address, geocoder(Response.json([])))).toBeNull();
		expect(await geocode(address, geocoder(hit('x', '13')))).toBeNull();
		await expect(geocode(address, geocoder(new Response('', { status: 429 })))).rejects.toThrow(
			'429'
		);
	});

	it('is off with GEOCODER_URL=off', () => {
		expect(geocodingEnabled()).toBe(true);
		env.GEOCODER_URL = 'off';
		expect(geocodingEnabled()).toBe(false);
	});
});

describe('locateProperties', () => {
	it('places the properties not placed yet one after the other, a second apart', async () => {
		const second = await seedUnit(db, 'a', { propertyName: 'Zwei' });
		await seedUnit(db, 'b');
		const pending = await propertiesToLocate(db, 'a', 5);
		expect(pending.map((row) => row.id).sort()).toEqual([propertyId, second.propertyId].sort());
		const pause = vi.fn(async () => {});
		await locateProperties(
			db,
			'a',
			pending,
			geocoder(hit('52.5', '13.4'), Response.json([])),
			pause
		);
		expect(pause).toHaveBeenCalledExactlyOnceWith(1100);
		const placed = [await stored(pending[0].id), await stored(pending[1].id)];
		expect(placed).toEqual([
			{ latitude: 52.5, longitude: 13.4, geocodedAddress: 'Lindenstraße 4, 10115 Berlin' },
			// No hit: asked, but placed by its postal code.
			{ latitude: null, longitude: null, geocodedAddress: 'Lindenstraße 4, 10115 Berlin' }
		]);
		expect(await propertiesToLocate(db, 'a', 5)).toEqual([]);
	});

	it('asks again after a changed address and leaves the rest for later after a failure', async () => {
		await seedUnit(db, 'a', { propertyName: 'Zwei' });
		await db
			.update(properties)
			.set({ geocodedAddress: 'Alte Straße 1, 10115 Berlin' })
			.where(eq(properties.id, propertyId));
		const pending = await propertiesToLocate(db, 'a', 5);
		expect(pending).toHaveLength(2);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await locateProperties(db, 'a', pending, geocoder(new Error('offline')), async () => {});
		expect(await propertiesToLocate(db, 'a', 5)).toHaveLength(2);
		expect(await propertiesToLocate(db, 'a', 1)).toHaveLength(1);
	});

	it('runs in the background unless it is off or there is no street map', async () => {
		const fetcher = geocoder(hit('52.5', '13.4'));
		vi.stubGlobal('fetch', fetcher);
		try {
			env.GEOCODER_URL = 'off';
			await locateInBackground(db, 'a');
			expect(fetcher).not.toHaveBeenCalled();
			env.GEOCODER_URL = 'https://geocoder.example/search';
			streetMap.map = null;
			await locateInBackground(db, 'a');
			expect(fetcher).not.toHaveBeenCalled();
			streetMap.map = {};
			await locateInBackground(db, 'b');
			expect(fetcher).not.toHaveBeenCalled();
			await locateInBackground(db, 'a');
			await vi.waitFor(async () => expect((await stored()).latitude).toBe(52.5));
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
