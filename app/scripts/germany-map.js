// Builds the map data of the property list: the outlines of Germany, its states and neighbours
// (src/lib/map/germany-outline.ts for the small maps, src/lib/map/germany-shapes.ts for the
// large one) and the coordinates of every German postal code
// (src/lib/server/postal-codes-data.ts). Everything is bundled, so the map loads no tiles and
// sends no address to another service. Run `node scripts/germany-map.js` to refresh the data.
//
// Sources: Natural Earth 1:10m (public domain) and the GeoNames postal codes (CC BY 4.0,
// www.geonames.org) in the conversion by zauberware/postal-codes-json-xml-csv.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { project, VIEW } from '../src/lib/map/projection.ts';

const naturalEarth =
	'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const postalCodes =
	'https://raw.githubusercontent.com/zauberware/postal-codes-json-xml-csv/master/data/DE.zip';
const root = path.resolve(import.meta.dirname, '..');

async function json(name) {
	const response = await fetch(`${naturalEarth}/${name}.geojson`);
	if (!response.ok) throw new Error(`${name}: ${response.status}`);
	return response.json();
}

/** The rings of a Polygon or MultiPolygon. */
function rings(geometry) {
	return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}

/** Douglas-Peucker on projected points. */
function simplify(points, tolerance) {
	if (points.length < 3) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack = [[0, points.length - 1]];
	while (stack.length) {
		const [first, last] = stack.pop();
		const [ax, ay] = points[first];
		const [bx, by] = points[last];
		const length = Math.hypot(bx - ax, by - ay);
		let worst = 0;
		let index = -1;
		for (let i = first + 1; i < last; i++) {
			const [px, py] = points[i];
			// A closed ring starts and ends on the same point: measure from that point.
			const distance = length
				? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
				: Math.hypot(px - ax, py - ay);
			if (distance > worst) {
				worst = distance;
				index = i;
			}
		}
		if (worst > tolerance) {
			keep[index] = 1;
			stack.push([first, index], [index, last]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

/** Sutherland-Hodgman: the part of a ring inside the rectangle. */
function clip(points, [minX, minY, maxX, maxY]) {
	const edges = [
		(p) => p[0] >= minX,
		(p) => p[0] <= maxX,
		(p) => p[1] >= minY,
		(p) => p[1] <= maxY
	];
	const cut = [
		(a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])],
		(a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])],
		(a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY],
		(a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY]
	];
	let output = points;
	for (let e = 0; e < 4 && output.length; e++) {
		const input = output;
		output = [];
		for (let i = 0; i < input.length; i++) {
			const current = input[i];
			const previous = input[(i + input.length - 1) % input.length];
			if (edges[e](current)) {
				if (!edges[e](previous)) output.push(cut[e](previous, current));
				output.push(current);
			} else if (edges[e](previous)) {
				output.push(cut[e](previous, current));
			}
		}
	}
	return output;
}

/** An SVG path of the features' rings, simplified, in projected units with one decimal. */
function toPath(features, { tolerance, minArea = 0, bounds }) {
	const parts = [];
	for (const feature of features) {
		for (const ring of rings(feature.geometry)) {
			let points = ring.map(([lon, lat]) => project(lat, lon));
			if (bounds) points = clip(points, bounds);
			points = simplify(points, tolerance);
			if (points.length < 3) continue;
			let area = 0;
			for (let i = 0; i < points.length; i++) {
				const [x1, y1] = points[i];
				const [x2, y2] = points[(i + 1) % points.length];
				area += x1 * y2 - x2 * y1;
			}
			if (Math.abs(area / 2) < minArea) continue;
			const coordinates = points.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`);
			parts.push(`M${coordinates.join('L')}Z`);
		}
	}
	return parts.join('');
}

const [states, countries, places] = await Promise.all([
	json('ne_10m_admin_1_states_provinces'),
	json('ne_10m_admin_0_countries'),
	json('ne_10m_populated_places_simple')
]);
const germanStates = states.features.filter((f) => f.properties.adm0_a3 === 'DEU');
const germany = countries.features.filter((f) => f.properties.ADM0_A3 === 'DEU');
// Wide enough that the clipped edges stay outside the large map on a wide screen.
const surroundings = [-700, -300, VIEW.width + 700, VIEW.height + 300];
const neighbours = countries.features.filter(
	(f) => f.properties.ADM0_A3 !== 'DEU' && f.properties.CONTINENT === 'Europe'
);
// The cities the overlay names, translated where Natural Earth uses English names.
const germanNames = {
	Munich: 'München',
	Cologne: 'Köln',
	Hanover: 'Hannover',
	Nuremberg: 'Nürnberg'
};
const cities = places.features
	.filter((f) => f.properties.adm0_a3 === 'DEU' && f.properties.pop_max >= 200000)
	.sort((a, b) => b.properties.pop_max - a.properties.pop_max)
	.map((f) => {
		const [x, y] = project(f.properties.latitude, f.properties.longitude);
		return {
			name: germanNames[f.properties.name] ?? f.properties.name,
			x: +x.toFixed(1),
			y: +y.toFixed(1)
		};
	});

const generated =
	'// Generated by scripts/germany-map.js from Natural Earth (public domain); do not edit.';
writeFileSync(
	path.join(root, 'src/lib/map/germany-outline.ts'),
	`${generated}

/** Germany as one outline, coarse enough for the small map of each property. */
export const germanyOutline = ${JSON.stringify(toPath(germany, { tolerance: 3, minArea: 20 }))};
`
);
const shapes = `${generated}

/** Germany's states, for the large map. */
export const stateShapes = ${JSON.stringify(toPath(germanStates, { tolerance: 0.25, minArea: 0.5 }))};

/** Germany's outline in the detail of the states. */
export const germanyDetail = ${JSON.stringify(toPath(germany, { tolerance: 0.25, minArea: 0.5 }))};

/** The neighbouring countries around Germany, clipped. */
export const neighbourShapes = ${JSON.stringify(toPath(neighbours, { tolerance: 1.5, minArea: 15, bounds: surroundings }))};

/** The largest German cities, most populous first. */
export const cities: { name: string; x: number; y: number }[] = ${JSON.stringify(cities)};
`;
writeFileSync(path.join(root, 'src/lib/map/germany-shapes.ts'), shapes);

// Postal codes: the mean position of each code's places, in hundredths of a degree.
const folder = mkdtempSync(path.join(tmpdir(), 'mietkartei-postal-codes-'));
try {
	const response = await fetch(postalCodes);
	if (!response.ok) throw new Error(`postal codes: ${response.status}`);
	writeFileSync(path.join(folder, 'DE.zip'), Buffer.from(await response.arrayBuffer()));
	execFileSync('unzip', ['-q', 'DE.zip', 'zipcodes.de.csv'], { cwd: folder });
	const lines = readFileSync(path.join(folder, 'zipcodes.de.csv'), 'utf8').trim().split('\n');
	const header = lines.shift().split(',');
	const [codeAt, latAt, lonAt] = ['zipcode', 'latitude', 'longitude'].map((n) => header.indexOf(n));
	const sums = new Map();
	for (const line of lines) {
		// Place names may contain commas; the coordinates are the last two fields.
		const fields = line.split(',');
		const offset = fields.length - header.length;
		const code = fields[codeAt];
		const lat = Number(fields[latAt + offset]);
		const lon = Number(fields[lonAt + offset]);
		if (!/^\d{5}$/.test(code) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		const sum = sums.get(code) ?? { lat: 0, lon: 0, count: 0 };
		sum.lat += lat;
		sum.lon += lon;
		sum.count++;
		sums.set(code, sum);
	}
	const entries = [...sums]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([code, { lat, lon, count }]) => {
			const hundredths = (value) => String(Math.round((value / count) * 100)).padStart(4, '0');
			return `${code}${hundredths(lat)}${hundredths(lon)}`;
		});
	writeFileSync(
		path.join(root, 'src/lib/server/postal-codes-data.ts'),
		`// Generated by scripts/germany-map.js from the GeoNames postal codes (CC BY 4.0, www.geonames.org);
// do not edit. Each entry: the postal code, then latitude and longitude in hundredths of a degree.
export const postalCodeData =
\t'${entries.join('')}';
`
	);
	console.log(`${entries.length} postal codes`);
} finally {
	rmSync(folder, { recursive: true, force: true });
}
