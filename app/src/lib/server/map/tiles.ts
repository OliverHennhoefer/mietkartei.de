import { PMTiles, type Source } from 'pmtiles';

// The street map of Germany as one PMTiles archive of vector tiles (OpenStreetMap data built by
// Protomaps). On cloudflare it lies in the R2 bucket MAP in parts of at most 256 MB, since
// wrangler uploads no larger object; map/manifest.json names them (see .github/workflows/map.yml).
// On node it is the file at MAP_TILES_PATH. Without either, the property list shows the outline
// map of Germany instead.

/** What .github/workflows/map.yml writes next to the parts. */
export type Manifest = { version: string; size: number; partSize: number; parts: string[] };

/** The byte ranges of the parts that hold the bytes from offset to offset + length. */
export function partRanges(manifest: Manifest, offset: number, length: number) {
	const ranges: { part: string; offset: number; length: number }[] = [];
	let at = offset;
	const end = Math.min(offset + length, manifest.size);
	while (at < end) {
		const index = Math.floor(at / manifest.partSize);
		const inPart = at - index * manifest.partSize;
		const take = Math.min(end - at, manifest.partSize - inPart);
		ranges.push({ part: manifest.parts[index], offset: inPart, length: take });
		at += take;
	}
	return ranges;
}

/** A source that reads the archive from its parts with `read(part, offset, length)`. */
export function partedSource(
	manifest: Manifest,
	read: (part: string, offset: number, length: number) => Promise<Uint8Array>
): Source {
	return {
		getKey: () => `map:${manifest.version}`,
		async getBytes(offset, length) {
			const chunks = await Promise.all(
				partRanges(manifest, offset, length).map((range) =>
					read(range.part, range.offset, range.length)
				)
			);
			const data = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
			let at = 0;
			for (const chunk of chunks) {
				data.set(chunk, at);
				at += chunk.length;
			}
			return { data: data.buffer };
		}
	};
}

export type StreetMap = { tiles: PMTiles; version: string };

let opened: { at: number; map: Promise<StreetMap | null> } | undefined;

/** How long an opened map is kept before the manifest is read again, for a new upload. */
const KEEP_MS = 10 * 60 * 1000;

/** The street map, or null where none is set up. Opened again every ten minutes. */
export function getStreetMap(now = Date.now()): Promise<StreetMap | null> {
	if (!opened || now - opened.at > KEEP_MS) {
		opened = {
			at: now,
			map: (async () => {
				try {
					if (__DEPLOY_TARGET__ === 'cloudflare') {
						const { openR2Map } = await import('./tiles-r2');
						return await openR2Map();
					}
					const { openFileMap } = await import('./tiles-fs');
					return await openFileMap();
				} catch (error) {
					console.error('[map] The street map could not be opened:', error);
					return null;
				}
			})()
		};
	}
	return opened.map;
}

/** Forgets the opened map, so the next call opens it again; for tests. */
export function resetStreetMap() {
	opened = undefined;
}
