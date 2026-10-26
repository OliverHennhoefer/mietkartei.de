import { env } from 'cloudflare:workers';
import { PMTiles } from 'pmtiles';
import { partedSource, type Manifest, type StreetMap } from './tiles';

/** The archive in the bucket MAP as named by map/manifest.json; null before the first upload. */
export async function openR2Map(): Promise<StreetMap | null> {
	const bucket = env.MAP;
	if (!bucket) return null;
	const object = await bucket.get('map/manifest.json');
	if (!object) return null;
	const manifest = (await object.json()) as Manifest;
	const source = partedSource(manifest, async (part, offset, length) => {
		const range = await bucket.get(part, { range: { offset, length } });
		if (!range) throw new Error(`Map part ${part} is missing`);
		return new Uint8Array(await range.arrayBuffer());
	});
	return { tiles: new PMTiles(source), version: manifest.version };
}
