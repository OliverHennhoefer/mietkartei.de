import { postalCodeData } from './postal-codes-data.ts';

// Where a property lies, from its postal code alone: the mean position of the code's places.
// The table is bundled, so no address leaves the server; a code it does not know has no position.

const ENTRY = 13;

/** The latitude and longitude of a German postal code, or null for an unknown one. */
export function locatePostalCode(postalCode: string): { lat: number; lon: number } | null {
	const code = postalCode.trim();
	if (!/^\d{5}$/.test(code)) return null;
	// The entries are sorted by code and all the same length: a binary search finds the code.
	let low = 0;
	let high = postalCodeData.length / ENTRY - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const start = middle * ENTRY;
		const candidate = postalCodeData.slice(start, start + 5);
		if (candidate === code) {
			return {
				lat: Number(postalCodeData.slice(start + 5, start + 9)) / 100,
				lon: Number(postalCodeData.slice(start + 9, start + 13)) / 100
			};
		}
		if (candidate < code) low = middle + 1;
		else high = middle - 1;
	}
	return null;
}
