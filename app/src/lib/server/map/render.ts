import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// Draws the surroundings of a property as a small SVG image from the vector tiles of the street
// map: land, water, parks, buildings and roads in the greys of the app, the property as a neon dot
// in the middle. Rendered on the server, so the browser loads one image and no map library.

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

type Layers = {
	land: string[];
	park: string[];
	water: string[];
	building: string[];
	roads: Record<string, string[]>;
};

/** The SVG image of the view; tiles that are missing or broken leave their area empty. */
export async function renderPreview(read: TileReader, view: Preview): Promise<string> {
	const dataZoom = Math.min(view.maxDataZoom, Math.floor(view.zoom));
	const scale = 2 ** (view.zoom - dataZoom);
	const [centerX, centerY] = worldPixel(view.lat, view.lon, view.zoom);
	const left = centerX - view.width / 2;
	const top = centerY - view.height / 2;
	const tileSize = TILE * scale;
	const layers: Layers = { land: [], park: [], water: [], building: [], roads: {} };
	const tiles: [number, number][] = [];
	for (
		let tx = Math.floor(left / tileSize);
		tx <= Math.floor((left + view.width) / tileSize);
		tx++
	) {
		for (
			let ty = Math.floor(top / tileSize);
			ty <= Math.floor((top + view.height) / tileSize);
			ty++
		) {
			tiles.push([tx, ty]);
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
	for (const entry of decoded) {
		if (!entry) continue;
		const originX = entry.tx * tileSize - left;
		const originY = entry.ty * tileSize - top;
		for (const name of ['earth', 'landuse', 'landcover', 'water', 'buildings', 'roads']) {
			const layer = entry.tile.layers[name];
			if (!layer) continue;
			const unit = tileSize / layer.extent;
			for (let i = 0; i < layer.length; i++) {
				const feature = layer.feature(i);
				const kind = String(feature.properties.kind ?? '');
				const target =
					name === 'earth'
						? layers.land
						: name === 'water'
							? feature.type === 3
								? layers.water
								: undefined
							: name === 'buildings'
								? layers.building
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
					view
				);
				if (path) target.push(path);
			}
		}
	}
	const roadOrder = ['path', 'other', 'minor_road', 'medium_road', 'major_road', 'highway'];
	const fill = (paths: string[], color: string) =>
		paths.length ? `<path fill="${color}" d="${paths.join('')}"/>` : '';
	const roads = roadOrder
		.filter((kind) => layers.roads[kind]?.length)
		.map((kind) => {
			const { color, width } = STYLE.roads[kind];
			const w = Math.max(0.6, width * Math.min(1.6, scale));
			return `<path fill="none" stroke="${color}" stroke-width="${+w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" d="${layers.roads[kind].join('')}"/>`;
		})
		.join('');
	const cx = view.width / 2;
	const cy = view.height / 2;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}">` +
		`<rect width="100%" height="100%" fill="${STYLE.background}"/>` +
		fill(layers.land, STYLE.land) +
		fill(layers.park, STYLE.park) +
		fill(layers.water, STYLE.water) +
		fill(layers.building, STYLE.building) +
		roads +
		`<circle cx="${cx}" cy="${cy}" r="15" fill="${STYLE.dot}" opacity="0.2"/>` +
		`<circle cx="${cx}" cy="${cy}" r="6" fill="${STYLE.dot}" stroke="#141414" stroke-width="2"/>` +
		`</svg>`
	);
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
		let last = '';
		for (const point of ring) {
			const x = originX + point.x * unit;
			const y = originY + point.y * unit;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
			const text = `${+x.toFixed(1)} ${+y.toFixed(1)}`;
			if (text !== last) points.push(text);
			last = text;
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
