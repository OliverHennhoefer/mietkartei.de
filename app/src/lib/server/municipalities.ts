import type { GermanState } from '../working-days.ts';
import { municipalityData } from './municipalities-data.ts';
import { locatePostalCode } from './postal-codes.ts';

// The Gemeinde of a property and what the official statistics say about it: the average
// Nettokaltmiete of the Zensus 2022 and the Hebesatz of the Grundsteuer B. The table is bundled
// (scripts/municipalities.py builds it), so no address leaves the server. The Gemeinde is found
// by the property's city name, near the position of its postal code; addresses name an Ortsteil
// or leave out "am Main" often enough that a near Gemeinde with a similar name counts too.

export type Municipality = {
	/** Amtlicher Gemeindeschlüssel, eight digits. */
	key: string;
	name: string;
	state: GermanState;
	lat: number;
	lon: number;
	/** The average Nettokaltmiete of rented flats in euro cents per square metre, Zensus 2022. */
	rentPerSquareMetre: number | null;
	/** The Hebesatz of the Grundsteuer B in percent. */
	propertyTaxRate: number | null;
};

export type MunicipalityMatch = Municipality & {
	/** True when the city name matched; false when only the postal code's position did. */
	byName: boolean;
};

/** The first two digits of the Gemeindeschlüssel name the Land. */
const stateOfKey: Record<string, GermanState> = {
	'01': 'SH',
	'02': 'HH',
	'03': 'NI',
	'04': 'HB',
	'05': 'NW',
	'06': 'HE',
	'07': 'RP',
	'08': 'BW',
	'09': 'BY',
	'10': 'SL',
	'11': 'BE',
	'12': 'BB',
	'13': 'MV',
	'14': 'SN',
	'15': 'ST',
	'16': 'TH'
};

/** A name match farther than this from the postal code is another place of the same name. */
const NAME_RADIUS_KM = 30;
/** Without a name match, the nearest Gemeinde counts only when its centre is this close. */
const POSITION_RADIUS_KM = 4;

/**
 * The rows of the bundled table: key;name;lat;lon;rent;rate, one Gemeinde per line, the position
 * of its centre in hundredths of a degree, the rent in cents per square metre, empty fields for missing values.
 */
export function parseMunicipalities(data: string): Municipality[] {
	const number = (field: string) => (field === '' ? null : Number(field));
	return data
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			const [key, name, lat, lon, rent, rate] = line.split(';');
			const state = stateOfKey[key.slice(0, 2)];
			if (!state) return [];
			return [
				{
					key,
					name,
					state,
					lat: Number(lat) / 100,
					lon: Number(lon) / 100,
					rentPerSquareMetre: number(rent),
					propertyTaxRate: number(rate)
				}
			];
		});
}

/**
 * A place name reduced for comparing: lower case without umlauts, the official suffix after a
 * comma ("Berlin, Stadt") and bracketed parts ("Halle (Saale)") left out.
 */
export function normalizeName(name: string): string {
	return name
		.split(',')[0]
		.replace(/\([^)]*\)/g, ' ')
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** The leading part of a name: "Frankfurt am Main" and "Frankfurt-Höchst" both give "frankfurt". */
function core(normalized: string): string {
	return normalized.split(/ (?:am|an|an der|im|in|in der|ob der|bei|vor der) /)[0].split(' ')[0];
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const x = (b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
	const y = b.lat - a.lat;
	return Math.hypot(x, y) * 111.2;
}

/**
 * The Gemeinde of a place: the nearest one whose name is the city's (or shares its leading word,
 * "Frankfurt" for "Frankfurt am Main"), else the nearest Gemeinde centre right at the postal code's position.
 * A state, when known, rules out the Gemeinden of other Länder.
 */
export function matchMunicipality(
	rows: readonly Municipality[],
	place: { lat: number; lon: number },
	city: string,
	state: GermanState | null = null
): MunicipalityMatch | null {
	const candidates = state ? rows.filter((row) => row.state === state) : rows;
	const wanted = normalizeName(city);
	const nearest = (list: readonly Municipality[], radius: number) => {
		let best: Municipality | null = null;
		let bestDistance = radius;
		for (const row of list) {
			const distance = distanceKm(place, row);
			if (distance <= bestDistance) {
				best = row;
				bestDistance = distance;
			}
		}
		return best;
	};
	if (wanted) {
		const exact = candidates.filter((row) => normalizeName(row.name) === wanted);
		const similar = candidates.filter((row) => core(normalizeName(row.name)) === core(wanted));
		const named = nearest(exact, NAME_RADIUS_KM) ?? nearest(similar, NAME_RADIUS_KM);
		if (named) return { ...named, byName: true };
	}
	const near = nearest(candidates, POSITION_RADIUS_KM);
	return near ? { ...near, byName: false } : null;
}

let rows: Municipality[] | undefined;

/** The Gemeinde of a property from its postal code, city and Land; null when none fits. */
export function findMunicipality(property: {
	postalCode: string;
	city: string;
	state: GermanState | null;
}): MunicipalityMatch | null {
	const place = locatePostalCode(property.postalCode);
	if (!place) return null;
	rows ??= parseMunicipalities(municipalityData);
	return matchMunicipality(rows, place, property.city, property.state);
}
