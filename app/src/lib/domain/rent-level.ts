// The Kaltmiete per square metre a property earns, to set beside the average of its Gemeinde.
// Only flats count: commercial units and parking spaces have other rents, and the Zensus average
// is one of rented flats.

export type RentedUnit = {
	kind: 'residential' | 'commercial' | 'parking';
	unit: { floorArea: number | null };
	currentRent: { baseRent: number };
};

export type RentLevel = {
	/** Euro cents per square metre, rounded to a cent. */
	perSquareMetre: number;
	/** The floor area the average is over, in square metres. */
	area: number;
	/** The leases counted. */
	count: number;
};

/** The average Kaltmiete per square metre of the leases of flats with a floor area; null if none. */
export function rentLevel(leases: readonly RentedUnit[]): RentLevel | null {
	const counted = leases.filter(
		(lease) => lease.kind === 'residential' && (lease.unit.floorArea ?? 0) > 0
	);
	if (counted.length === 0) return null;
	const area = counted.reduce((sum, lease) => sum + (lease.unit.floorArea ?? 0), 0);
	const rent = counted.reduce((sum, lease) => sum + lease.currentRent.baseRent, 0);
	return { perSquareMetre: Math.round(rent / area), area, count: counted.length };
}

/** How far the property's rent lies above (positive) or below the average, in percent. */
export function deviation(own: number, average: number): number {
	return Math.round(((own - average) / average) * 1000) / 10;
}
