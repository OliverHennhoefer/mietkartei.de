import { describe, expect, it } from 'vitest';
import { storeDocument } from './server/documents';
import { documentPath, exportZip } from './server/export';
import { contextA, memoryStorage, testDatabase } from './server/testing';
import { readZip } from './zip-reader';

/** A stream that hands out `bytes` in pieces of `size`, as a file is read in the browser. */
function pieces(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) controller.close();
			else controller.enqueue(bytes.subarray(offset, (offset += size)));
		}
	});
}

describe('readZip', () => {
	it('reads export.json and every document of an export, one after another', async () => {
		const db = await testDatabase();
		const storage = memoryStorage();
		const stored = [];
		for (const size of [3, 70000, 5]) {
			const bytes = new Uint8Array(size).map((_, index) => index % 251);
			const result = await storeDocument(
				db,
				contextA,
				{ name: `Beleg ${size}.pdf`, mimeType: 'application/pdf', bytes },
				{ storage }
			);
			if (!result.ok) throw new Error(result.reason);
			stored.push({ path: documentPath({ id: result.id, name: `Beleg ${size}.pdf` }), bytes });
		}
		const zip = new Uint8Array(
			await new Response(await exportZip(db, contextA, { storage })).arrayBuffer()
		);

		const files: { path: string; bytes: Uint8Array }[] = [];
		let busy = false;
		await readZip(pieces(zip, 1000), async (path, bytes) => {
			// The next file waits until this one is handled.
			expect(busy).toBe(false);
			busy = true;
			await new Promise((resolve) => setTimeout(resolve, 1));
			files.push({ path, bytes });
			busy = false;
		});

		expect(files[0].path).toBe('export.json');
		expect(JSON.parse(new TextDecoder().decode(files[0].bytes))).toMatchObject({
			format: 'mietkartei'
		});
		expect(files.slice(1).sort((x, y) => x.path.localeCompare(y.path))).toEqual(
			stored.sort((x, y) => x.path.localeCompare(y.path))
		);
	});

	it('finds no files in what is not a ZIP', async () => {
		const files: string[] = [];
		const bytes = new TextEncoder().encode('Kein Archiv, nur Text. '.repeat(20));
		await readZip(pieces(bytes, 7), async (path) => void files.push(path));
		expect(files).toEqual([]);
	});
});
