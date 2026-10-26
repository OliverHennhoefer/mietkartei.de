import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { GEOCODER_URL } from '$app/env/private';
import type { Database } from './db/index.ts';
import { properties } from './db/schema.ts';
import { getStreetMap } from './map/tiles.ts';

// Where a property lies, for its street map: the server asks a Nominatim geocoder once per
// address, by default the public one of OpenStreetMap. Only the address of the property is sent,
// nothing of the user or the tenants. The usage policy of the public server allows one request
// per second, so the properties of a list are asked one after the other, in the background.
// Until an answer is there, and if there is none, the map places a property by its postal code.

export type Address = { street: string; postalCode: string; city: string };

/** The address as the geocoder is asked for it, and as it is kept to notice a change. */
export function addressKey(address: Address): string {
	return `${address.street.trim()}, ${address.postalCode.trim()} ${address.city.trim()}`;
}

const USER_AGENT = 'mietkartei (+https://mietkartei.de)';

/**
 * The position of the address, or null when the geocoder knows none. Throws when it cannot be
 * asked (network, rate limit), so the caller asks again later.
 */
export async function geocode(
	address: Address,
	fetcher: typeof fetch = fetch
): Promise<{ lat: number; lon: number } | null> {
	const url = new URL(GEOCODER_URL);
	url.searchParams.set('street', address.street.trim());
	url.searchParams.set('postalcode', address.postalCode.trim());
	url.searchParams.set('city', address.city.trim());
	url.searchParams.set('countrycodes', 'de');
	url.searchParams.set('format', 'jsonv2');
	url.searchParams.set('limit', '1');
	const response = await fetcher(url, {
		headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
		signal: AbortSignal.timeout(8000)
	});
	if (!response.ok) throw new Error(`Geocoder answered ${response.status}`);
	const [hit] = (await response.json()) as { lat: string; lon: string }[];
	if (!hit) return null;
	const lat = Number(hit.lat);
	const lon = Number(hit.lon);
	return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Whether properties are placed by their address at all (GEOCODER_URL is not "off"). */
export function geocodingEnabled(): boolean {
	return GEOCODER_URL !== 'off';
}

/** The account's properties whose address was not asked yet or has changed since. */
export async function propertiesToLocate(db: Database, accountId: string, limit: number) {
	const rows = await db
		.select({
			id: properties.id,
			street: properties.street,
			postalCode: properties.postalCode,
			city: properties.city,
			geocodedAddress: properties.geocodedAddress
		})
		.from(properties)
		.where(and(eq(properties.accountId, accountId), isNull(properties.archivedAt)));
	return rows.filter((row) => row.geocodedAddress !== addressKey(row)).slice(0, limit);
}

/** Asks for each property in turn, a second apart; one that fails is asked on a later visit. */
export async function locateProperties(
	db: Database,
	accountId: string,
	pending: (Address & { id: string })[],
	fetcher: typeof fetch = fetch,
	pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
	for (const [index, property] of pending.entries()) {
		if (index > 0) await pause(1100);
		const key = addressKey(property);
		let position: { lat: number; lon: number } | null;
		try {
			position = await geocode(property, fetcher);
		} catch (error) {
			console.warn('[geocoding] The address could not be placed, it is asked again later:', error);
			return;
		}
		await db
			.update(properties)
			.set({
				latitude: position?.lat ?? null,
				longitude: position?.lon ?? null,
				geocodedAddress: key
			})
			.where(
				and(
					eq(properties.id, property.id),
					eq(properties.accountId, accountId),
					// Not over a newer answer for an address changed in the meantime.
					or(isNull(properties.geocodedAddress), ne(properties.geocodedAddress, key))
				)
			);
	}
}

/**
 * Places up to `limit` properties of the account that need it, without making the response wait
 * for the geocoder; their maps show the result from the next page load on. Without a street map
 * no address leaves the server.
 */
export async function locateInBackground(
	db: Database,
	accountId: string,
	limit = 3
): Promise<void> {
	if (!geocodingEnabled() || !(await getStreetMap())) return;
	const pending = await propertiesToLocate(db, accountId, limit);
	if (pending.length === 0) return;
	const running = locateProperties(db, accountId, pending).catch((error: unknown) =>
		console.error('[geocoding] Placing the properties failed:', error)
	);
	if (__DEPLOY_TARGET__ === 'cloudflare') {
		const { waitUntil } = await import('cloudflare:workers');
		waitUntil(running);
	}
}
