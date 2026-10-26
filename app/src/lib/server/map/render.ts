import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// Draws the street map as SVG images from its vector tiles: land, water, parks, buildings, borders
// and roads in the greys of the app. The small map of a property shows it as a neon dot in the
// middle; the tiles of the interactive map add the names of places. Rendered on the server, so
// the browser loads images and no map data or fonts from elsewhere.

export type TileReader = (z: number, x: number, y: number) => Promise<Uint8Array | undefined>;

export type Preview = {
	lat: number;
	lon: number;
	/** Web Mercator zoom of the image, fractional allowed. */
	zoom: number;
	width: number;
	height: number;
	/** The deepest zoom the tiles have; deeper views scale its tiles up. */
	maxDataZoom: number;
};

const TILE = 256;

/** The position in Web Mercator pixels at the zoom. */
export function worldPixel(lat: number, lon: number, zoom: number): [number, number] {
	const size = TILE * 2 ** zoom;
	const sin = Math.sin((lat * Math.PI) / 180);
	return [
		((lon + 180) / 360) * size,
		(0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
	];
}

/** Colours of the dark map, the same in both colour schemes; see --color-map-* in app.css. */
const STYLE = {
	background: '#141414',
	land: '#222',
	park: '#272727',
	water: '#141414',
	building: '#2e2e2e',
	boundary: '#555',
	label: '#9a9a9a',
	roads: {
		highway: { color: '#6e6e6e', width: 3.2 },
		major_road: { color: '#5c5c5c', width: 2.6 },
		medium_road: { color: '#4d4d4d', width: 2 },
		minor_road: { color: '#424242', width: 1.4 },
		other: { color: '#363636', width: 0.9 },
		path: { color: '#333', width: 0.7 }
	} as Record<string, { color: string; width: number }>,
	dot: '#f5ff00'
};

const parks = new Set([
	'park',
	'forest',
	'wood',
	'grass',
	'meadow',
	'garden',
	'cemetery',
	'nature_reserve'
]);

type Label = { x: number; y: number; text: string; size: number };

type Layers = {
	land: string[];
	park: string[];
	water: string[];
	building: string[];
	boundary: string[];
	roads: Record<string, string[]>;
	labels: Label[];
};

/** A section of the map in Web Mercator pixels at its zoom. */
type Area = {
	zoom: number;
	left: number;
	top: number;
	width: number;
	height: number;
	maxDataZoom: number;
};

/** The places a map tile names: towns and cities, and their quarters from zoom 12 on. */
const placeKinds = new Set(['locality', 'neighbourhood', 'macrohood']);

/** Reads the tiles under the area and sorts their features into the layers to draw. */
async function collect(read: TileReader, area: Area, labels: boolean): Promise<Layers> {
	const dataZoom = Math.min(area.maxDataZoom, Math.floor(area.zoom));
	const tileSize = TILE * 2 ** (area.zoom - dataZoom);
	const layers: Layers = {
		land: [],
		park: [],
		water: [],
		building: [],
		boundary: [],
		roads: {},
		labels: []
	};
	const tiles: [number, number][] = [];
	const count = 2 ** dataZoom;
	const lastX = Math.floor((area.left + area.width - 0.001) / tileSize);
	const lastY = Math.floor((area.top + area.height - 0.001) / tileSize);
	for (let tx = Math.floor(area.left / tileSize); tx <= lastX; tx++) {
		for (let ty = Math.floor(area.top / tileSize); ty <= lastY; ty++) {
			if (tx >= 0 && ty >= 0 && tx < count && ty < count) tiles.push([tx, ty]);
		}
	}
	const decoded = await Promise.all(
		tiles.map(async ([tx, ty]) => {
			try {
				const bytes = await read(dataZoom, tx, ty);
				return bytes ? { tx, ty, tile: new VectorTile(new PbfReader(bytes)) } : undefined;
			} catch (error) {
				console.error(`[map] Tile ${dataZoom}/${tx}/${ty} could not be read:`, error);
				return undefined;
			}
		})
	);
	const names = ['earth', 'landuse', 'landcover', 'water', 'boundaries', 'buildings', 'roads'];
	if (labels) names.push('places');
	for (const entry of decoded) {
		if (!entry) continue;
		const originX = entry.tx * tileSize - area.left;
		const originY = entry.ty * tileSize - area.top;
		for (const name of names) {
			const layer = entry.tile.layers[name];
			if (!layer) continue;
			const unit = tileSize / layer.extent;
			for (let i = 0; i < layer.length; i++) {
				const feature = layer.feature(i);
				const kind = String(feature.properties.kind ?? '');
				if (name === 'places') {
					const label = placeLabel(feature, originX, originY, unit, area);
					if (label) layers.labels.push(label);
					continue;
				}
				const target =
					name === 'earth'
						? layers.land
						: name === 'water'
							? feature.type === 3
								? layers.water
								: undefined
							: name === 'buildings'
								? layers.building
								: name === 'boundaries'
									? kind === 'country' || kind === 'region'
										? layers.boundary
										: undefined
									: name === 'roads'
										? (layers.roads[STYLE.roads[kind] ? kind : 'other'] ??= [])
										: parks.has(kind)
											? layers.park
											: undefined;
				if (!target) continue;
				const path = toPath(
					feature.loadGeometry(),
					feature.type === 3,
					originX,
					originY,
					unit,
					area
				);
				if (path) target.push(path);
			}
		}
	}
	return layers;
}

/**
 * The label of a place that the map shows at this zoom, if it fits wholly into the area: a tile
 * cuts no names in half, and its neighbour does not draw the same name a second time.
 */
function placeLabel(
	feature: VectorTileFeature,
	originX: number,
	originY: number,
	unit: number,
	area: Area
): Label | undefined {
	const kind = String(feature.properties.kind ?? '');
	const minZoom = Number(feature.properties.min_zoom ?? 0);
	if (!placeKinds.has(kind) || minZoom > area.zoom + 0.5) return undefined;
	if (kind !== 'locality' && area.zoom < 12) return undefined;
	const text = String(feature.properties['name:de'] ?? feature.properties.name ?? '');
	if (!text) return undefined;
	const rank = Number(feature.properties.population_rank ?? 0);
	const size = kind === 'locality' ? (rank >= 11 ? 14 : rank >= 9 ? 12.5 : 11) : 10.5;
	const [point] = feature.loadGeometry()[0] ?? [];
	if (!point) return undefined;
	const x = originX + point.x * unit;
	const y = originY + point.y * unit;
	const half = (text.length * size * 0.56) / 2 + 3;
	if (x - half < 0 || x + half > area.width || y - size - 3 < 0 || y + 4 > area.height) {
		return undefined;
	}
	return { x, y, text, size };
}

const escape = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The layers as SVG elements, bottom to top. */
function draw(layers: Layers, zoom: number, scale: number): string {
	const roadOrder = ['path', 'other', 'minor_road', 'medium_road', 'major_road', 'highway'];
	const fill = (paths: string[], color: string) =>
		paths.length ? `<path fill="${color}" d="${paths.join('')}"/>` : '';
	// Roads grow up to 1.6 times their width when tiles are scaled up; further out they thin.
	const roadScale = zoom >= 13 ? Math.min(1.6, scale) : Math.max(0.3, (zoom - 5) / 8);
	const roads = roadOrder
		.filter((kind) => layers.roads[kind]?.length)
		.map((kind) => {
			const { color, width } = STYLE.roads[kind];
			const w = Math.max(0.6, width * roadScale);
			return `<path fill="none" stroke="${color}" stroke-width="${+w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" d="${layers.roads[kind].join('')}"/>`;
		})
		.join('');
	const boundaries = layers.boundary.length
		? `<path fill="none" stroke="${STYLE.boundary}" stroke-width="1" stroke-dasharray="4 3" d="${layers.boundary.join('')}"/>`
		: '';
	const labels = layers.labels
		.map(
			(label) =>
				`<text x="${+label.x.toFixed(1)}" y="${+label.y.toFixed(1)}" font-size="${label.size}">${escape(label.text)}</text>`
		)
		.join('');
	return (
		fill(layers.land, STYLE.land) +
		fill(layers.park, STYLE.park) +
		fill(layers.water, STYLE.water) +
		fill(layers.building, STYLE.building) +
		boundaries +
		roads +
		(labels
			? `<g font-family="system-ui, sans-serif" text-anchor="middle" fill="${STYLE.label}" stroke="${STYLE.background}" stroke-width="3" paint-order="stroke">${labels}</g>`
			: '')
	);
}

const svg = (width: number, height: number, body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
	`<rect width="100%" height="100%" fill="${STYLE.background}"/>${body}</svg>`;

/** The SVG image of the view; tiles that are missing or broken leave their area empty. */
export async function renderPreview(read: TileReader, view: Preview): Promise<string> {
	const [centerX, centerY] = worldPixel(view.lat, view.lon, view.zoom);
	const area = {
		...view,
		left: centerX - view.width / 2,
		top: centerY - view.height / 2
	};
	const dataZoom = Math.min(view.maxDataZoom, Math.floor(view.zoom));
	const layers = await collect(read, area, false);
	const cx = view.width / 2;
	const cy = view.height / 2;
	return svg(
		view.width,
		view.height,
		draw(layers, view.zoom, 2 ** (view.zoom - dataZoom)) +
			`<circle cx="${cx}" cy="${cy}" r="15" fill="${STYLE.dot}" opacity="0.2"/>` +
			`<circle cx="${cx}" cy="${cy}" r="6" fill="${STYLE.dot}" stroke="#141414" stroke-width="2"/>`
	);
}

/** One map tile of 256 pixels for the interactive map, with the names of the places on it. */
export async function renderTile(
	read: TileReader,
	z: number,
	x: number,
	y: number,
	maxDataZoom: number
): Promise<string> {
	const area = { zoom: z, left: x * TILE, top: y * TILE, width: TILE, height: TILE, maxDataZoom };
	const layers = await collect(read, area, true);
	return svg(TILE, TILE, draw(layers, z, 2 ** (z - Math.min(maxDataZoom, z))));
}

/**
 * The geometry as path data in image pixels with one decimal, without the parts that lie wholly
 * outside the image and without repeated points.
 */
function toPath(
	rings: { x: number; y: number }[][],
	closed: boolean,
	originX: number,
	originY: number,
	unit: number,
	view: { width: number; height: number }
): string {
	const margin = 8;
	let path = '';
	for (const ring of rings) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const points: string[] = [];
		let lastX = NaN;
		let lastY = NaN;
		for (const [index, point] of ring.entries()) {
			const x = originX + point.x * unit;
			const y = originY + point.y * unit;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
			// Points closer than half a pixel to the last one drawn add nothing but bytes.
			if (Math.abs(x - lastX) + Math.abs(y - lastY) < 0.5 && index < ring.length - 1) continue;
			const text = `${+x.toFixed(1)} ${+y.toFixed(1)}`;
			if (`${+lastX.toFixed(1)} ${+lastY.toFixed(1)}` !== text) points.push(text);
			lastX = x;
			lastY = y;
		}
		if (
			maxX < -margin ||
			maxY < -margin ||
			minX > view.width + margin ||
			minY > view.height + margin
		) {
			continue;
		}
		if (
			points.length < 2 ||
			(closed && (points.length < 3 || maxX - minX < 0.8 || maxY - minY < 0.8))
		) {
			continue;
		}
		path += `M${points.join('L')}${closed ? 'Z' : ''}`;
	}
	return path;
}
