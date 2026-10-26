import { PbfWriter } from 'pbf';
import { zxyToTileId } from 'pmtiles';

// Writes vector tiles and PMTiles archives, for the unit tests and for the made-up street map of
// the end-to-end tests and screenshots (scripts/map-fixture.js); the real map comes from Protomaps
// (see .github/workflows/map.yml). Only what those need: uncompressed archives with one root
// directory, and tiles with lines and polygons.

export type FixtureFeature = {
	type: 'line' | 'polygon';
	properties: Record<string, string>;
	/** Rings or lines in tile coordinates (0 … extent). */
	geometry: [number, number][][];
};

export type FixtureLayer = { name: string; features: FixtureFeature[] };

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

/** One Mapbox vector tile (protobuf) with the given layers and an extent of 4096. */
export function encodeTile(layers: FixtureLayer[]): Uint8Array {
	const pbf = new PbfWriter();
	for (const layer of layers) {
		pbf.writeMessage(
			3,
			(_: unknown, out: PbfWriter) => {
				out.writeVarintField(15, 2);
				out.writeStringField(1, layer.name);
				const keys: string[] = [];
				const values: string[] = [];
				for (const feature of layer.features) {
					const tags: number[] = [];
					for (const [key, value] of Object.entries(feature.properties)) {
						if (!keys.includes(key)) keys.push(key);
						if (!values.includes(value)) values.push(value);
						tags.push(keys.indexOf(key), values.indexOf(value));
					}
					const commands: number[] = [];
					let x = 0;
					let y = 0;
					for (const part of feature.geometry) {
						const points = feature.type === 'polygon' ? part.slice(0, -1) : part;
						commands.push((1 & 7) | (1 << 3), zigzag(points[0][0] - x), zigzag(points[0][1] - y));
						[x, y] = points[0];
						commands.push((2 & 7) | ((points.length - 1) << 3));
						for (const [px, py] of points.slice(1)) {
							commands.push(zigzag(px - x), zigzag(py - y));
							[x, y] = [px, py];
						}
						if (feature.type === 'polygon') commands.push((7 & 7) | (1 << 3));
					}
					out.writeMessage(
						2,
						(__: unknown, f: PbfWriter) => {
							f.writePackedVarint(2, tags);
							f.writeVarintField(3, feature.type === 'line' ? 2 : 3);
							f.writePackedVarint(4, commands);
						},
						undefined
					);
				}
				for (const key of keys) out.writeStringField(3, key);
				for (const value of values) {
					out.writeMessage(
						4,
						(__: unknown, v: PbfWriter) => v.writeStringField(1, value),
						undefined
					);
				}
				out.writeVarintField(5, 4096);
			},
			undefined
		);
	}
	return pbf.finish();
}

function varints(numbers: number[]): number[] {
	const bytes: number[] = [];
	for (let n of numbers) {
		while (n >= 0x80) {
			bytes.push((n % 0x80) | 0x80);
			n = Math.floor(n / 0x80);
		}
		bytes.push(n);
	}
	return bytes;
}

/** A PMTiles v3 archive of vector tiles, keyed "z/x/y". */
export function writeArchive(tiles: Record<string, Uint8Array>): Uint8Array {
	const entries = Object.entries(tiles)
		.map(([key, data]) => {
			const [z, x, y] = key.split('/').map(Number);
			return { id: zxyToTileId(z, x, y), z, data };
		})
		.sort((a, b) => a.id - b.id);
	let offset = 0;
	const offsets = entries.map((entry) => {
		const at = offset;
		offset += entry.data.length;
		return at;
	});
	const directory = Uint8Array.from([
		...varints([entries.length]),
		...varints(entries.map((entry, i) => entry.id - (i ? entries[i - 1].id : 0))),
		...varints(entries.map(() => 1)),
		...varints(entries.map((entry) => entry.data.length)),
		...varints(
			offsets.map((at, i) =>
				i > 0 && at === offsets[i - 1] + entries[i - 1].data.length ? 0 : at + 1
			)
		)
	]);
	const metadata = new TextEncoder().encode('{}');
	const header = new DataView(new ArrayBuffer(127));
	new Uint8Array(header.buffer).set(new TextEncoder().encode('PMTiles'), 0);
	header.setUint8(7, 3);
	const u64 = (at: number, value: number) => header.setBigUint64(at, BigInt(value), true);
	const rootAt = 127;
	const metadataAt = rootAt + directory.length;
	const dataAt = metadataAt + metadata.length;
	u64(8, rootAt);
	u64(16, directory.length);
	u64(24, metadataAt);
	u64(32, metadata.length);
	u64(40, dataAt);
	u64(48, 0);
	u64(56, dataAt);
	u64(64, offset);
	u64(72, entries.length);
	u64(80, entries.length);
	u64(88, entries.length);
	header.setUint8(96, 1); // clustered
	header.setUint8(97, 1); // internal compression: none
	header.setUint8(98, 1); // tile compression: none
	header.setUint8(99, 1); // MVT
	header.setUint8(100, Math.min(...entries.map((entry) => entry.z)));
	header.setUint8(101, Math.max(...entries.map((entry) => entry.z)));
	header.setInt32(102, -180e7, true);
	header.setInt32(106, -85e7, true);
	header.setInt32(110, 180e7, true);
	header.setInt32(114, 85e7, true);
	const archive = new Uint8Array(dataAt + offset);
	archive.set(new Uint8Array(header.buffer), 0);
	archive.set(directory, rootAt);
	archive.set(metadata, metadataAt);
	let at = dataAt;
	for (const entry of entries) {
		archive.set(entry.data, at);
		at += entry.data.length;
	}
	return archive;
}

/**
 * A made-up quarter for one tile: a street grid with a main road, blocks of houses, a park and a
 * river, varied by the tile coordinates so neighbouring tiles differ.
 */
export function fixtureQuarter(x: number, y: number): FixtureLayer[] {
	const random = (() => {
		let seed = (x * 73856093) ^ (y * 19349663);
		return () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
	})();
	const step = 512;
	const roads: FixtureFeature[] = [];
	const buildings: FixtureFeature[] = [];
	for (let at = 0; at <= 4096; at += step) {
		const kind = at === 2048 ? 'major_road' : 'minor_road';
		roads.push({
			type: 'line',
			properties: { kind },
			geometry: [
				[
					[at, -64],
					[at, 4160]
				]
			]
		});
		roads.push({
			type: 'line',
			properties: { kind },
			geometry: [
				[
					[-64, at],
					[4160, at]
				]
			]
		});
	}
	for (let bx = 0; bx < 4096; bx += step) {
		for (let by = 0; by < 4096; by += step) {
			if (random() < 0.15) continue;
			for (let i = 0; i < 4; i++) {
				const left = bx + 60 + (i % 2) * 200;
				const top = by + 60 + Math.floor(i / 2) * 200;
				const size = 120 + Math.floor(random() * 60);
				buildings.push({
					type: 'polygon',
					properties: { kind: 'building' },
					geometry: [
						[
							[left, top],
							[left + size, top],
							[left + size, top + size],
							[left, top + size],
							[left, top]
						]
					]
				});
			}
		}
	}
	const parkX = Math.floor(random() * 6) * step;
	const square = (left: number, top: number, width: number, height: number): [number, number][] => [
		[left, top],
		[left + width, top],
		[left + width, top + height],
		[left, top + height],
		[left, top]
	];
	return [
		{
			name: 'earth',
			features: [{ type: 'polygon', properties: {}, geometry: [square(-64, -64, 4224, 4224)] }]
		},
		{
			name: 'landuse',
			features: [
				{
					type: 'polygon',
					properties: { kind: 'park' },
					geometry: [square(parkX + 20, 1044, 984, 984)]
				}
			]
		},
		{
			name: 'water',
			features: [
				{
					type: 'polygon',
					properties: { kind: 'river' },
					geometry: [
						[
							[-64, 3300],
							[1500, 3150],
							[3000, 3400],
							[4160, 3250],
							[4160, 3550],
							[3000, 3700],
							[1500, 3450],
							[-64, 3600],
							[-64, 3300]
						]
					]
				}
			]
		},
		{ name: 'roads', features: roads },
		{ name: 'buildings', features: buildings }
	];
}
