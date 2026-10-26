import { open, stat } from 'node:fs/promises';
import { MAP_TILES_PATH } from '$app/env/private';
import { PMTiles } from 'pmtiles';
import { partedSource, type StreetMap } from './tiles';

/** The archive at MAP_TILES_PATH as a single part; null when the variable is not set. */
export async function openFileMap(): Promise<StreetMap | null> {
	if (!MAP_TILES_PATH) return null;
	const { size, mtimeMs } = await stat(MAP_TILES_PATH);
	const version = `${size}-${Math.round(mtimeMs)}`;
	const source = partedSource(
		{ version, size, partSize: size, parts: [MAP_TILES_PATH] },
		async (path, offset, length) => {
			const file = await open(path, 'r');
			try {
				const buffer = new Uint8Array(length);
				const { bytesRead } = await file.read(buffer, 0, length, offset);
				return buffer.subarray(0, bytesRead);
			} finally {
				await file.close();
			}
		}
	);
	return { tiles: new PMTiles(source), version };
}
