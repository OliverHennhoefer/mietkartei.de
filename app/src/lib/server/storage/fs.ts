import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { DATABASE_PATH, DATA_DIR } from '$app/env/private';
import type { Storage } from './index';

/** DATA_DIR, or a `documents` directory next to the database file. */
export function documentsDirectory(): string {
	return DATA_DIR || join(dirname(DATABASE_PATH), 'documents');
}

/** Documents as files below DATA_DIR, with the content type kept next to each file. */
export function openFileStorage(root = documentsDirectory()): Storage {
	function path(key: string): string {
		const safe = normalize(key);
		if (safe.startsWith('..') || safe.includes('\0'))
			throw new Error(`Invalid storage key: ${key}`);
		return join(root, safe);
	}

	return {
		async put(key, body, contentType) {
			const file = path(key);
			await mkdir(dirname(file), { recursive: true });
			const bytes =
				body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
			await writeFile(file, bytes);
			await writeFile(`${file}.type`, contentType);
		},
		async get(key) {
			const file = path(key);
			let size: number;
			try {
				size = (await stat(file)).size;
			} catch {
				return undefined;
			}
			const contentType = await readType(`${file}.type`);
			const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
			return { body, contentType, size };
		},
		async delete(key) {
			const file = path(key);
			await rm(file, { force: true });
			await rm(`${file}.type`, { force: true });
		}
	};
}

async function readType(file: string): Promise<string> {
	try {
		const { readFile } = await import('node:fs/promises');
		return (await readFile(file, 'utf8')).trim() || 'application/octet-stream';
	} catch {
		return 'application/octet-stream';
	}
}
