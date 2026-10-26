import { addressKey, type Address } from '../geocoding.ts';
import { locatePostalCode } from '../postal-codes.ts';

// What the small map of a property shows: its exact position from the geocoder, zoomed in to its
// streets, or, until there is one, the middle of its postal code area from further away.

export const PREVIEW = { width: 480, height: 240 } as const;

export type PlacedProperty = Address & {
	latitude: number | null;
	longitude: number | null;
	geocodedAddress: string | null;
};

export type MapCenter = { lat: number; lon: number; zoom: number; exact: boolean };

export function mapCenter(property: PlacedProperty): MapCenter | null {
	if (
		property.latitude !== null &&
		property.longitude !== null &&
		property.geocodedAddress === addressKey(property)
	) {
		return { lat: property.latitude, lon: property.longitude, zoom: 15.5, exact: true };
	}
	const area = locatePostalCode(property.postalCode);
	return area ? { ...area, zoom: 13.5, exact: false } : null;
}

/** Changes with everything the image depends on, so the browser may keep it for long. */
export function previewVersion(center: MapCenter, mapVersion: string): string {
	return `${mapVersion}-${center.lat.toFixed(5)}-${center.lon.toFixed(5)}-${center.zoom}`;
}
