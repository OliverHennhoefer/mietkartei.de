import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';

// Reads a ZIP (the export) as a stream in the browser, one file at a time, so an archive of
// many documents is never held whole. Folders are skipped.

/**
 * Calls `onFile` with each file of the archive in the order of the archive, and waits for it
 * before reading on. Throws when a file cannot be unpacked; what is not a ZIP at all yields no
 * files.
 */
export async function readZip(
	stream: ReadableStream<Uint8Array>,
	onFile: (path: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>
): Promise<void> {
	const ready: { path: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
	let broken: Error | undefined;
	const unzip = new Unzip((entry: UnzipFile) => {
		if (entry.name.endsWith('/')) return;
		const parts: Uint8Array[] = [];
		entry.ondata = (error, chunk, final) => {
			if (error) {
				broken = error;
				return;
			}
			parts.push(chunk);
			if (final) ready.push({ path: entry.name, bytes: concat(parts) });
		};
		entry.start();
	});
	unzip.register(UnzipInflate);

	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		unzip.push(value ?? new Uint8Array(0), done);
		if (broken) {
			await reader.cancel();
			throw broken;
		}
		for (const { path, bytes } of ready.splice(0)) await onFile(path, bytes);
		if (done) return;
	}
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}
