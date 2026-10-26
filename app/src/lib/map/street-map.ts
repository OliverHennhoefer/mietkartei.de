// What the interactive street map and its tiles share: the zooms it offers and the part of the
// world it shows, Germany with a margin (the area the Map workflow extracts).

/** The zooms of the interactive map: Germany as a whole down to single houses. */
export const TILE_ZOOMS = { min: 5, max: 17 } as const;

/** South-west and north-east corner as [lat, lon]. */
export const GERMANY_BOUNDS: [[number, number], [number, number]] = [
	[47.1, 5.5],
	[55.2, 15.5]
];
