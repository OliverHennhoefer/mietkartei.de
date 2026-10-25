// A plain equirectangular projection around Germany: longitude shrunk by the cosine of its mean
// latitude, so the country keeps its shape. One unit is a hundredth of a degree of latitude
// (about 1.1 km); the view below frames the whole country.

const NORTH = 55.1;
const WEST = 5.8;
const SCALE = 100;
const LON_SCALE = Math.cos((51.2 * Math.PI) / 180);

/** The frame of Germany in projected units. */
export const VIEW = { width: 580, height: 790 } as const;

/** A position in projected units, x to the east and y to the south. */
export function project(lat: number, lon: number): [number, number] {
	return [(lon - WEST) * LON_SCALE * SCALE, (NORTH - lat) * SCALE];
}
