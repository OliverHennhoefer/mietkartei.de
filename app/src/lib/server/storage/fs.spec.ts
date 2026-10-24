import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Storage } from './index';
import { accountPrefix, getStorage, storageKey } from './index';

const env = vi.hoisted(() => ({ DATABASE_PATH: '/srv/mietkartei/data.db', DATA_DIR: '' }));
vi.mock('$app/env/private', () => env);

const { documentsDirectory, openFileStorage } = await import('./fs');

let root: string;
let storage: Storage;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mietkartei-fs-'));
	storage = openFileStorage(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	env.DATA_DIR = '';
});

async function text(body: ReadableStream) {
	return new Response(body).text();
}

describe('documentsDirectory', () => {
	it('keeps the documents next to the database unless DATA_DIR is set', () => {
		expect(documentsDirectory()).toBe('/srv/mietkartei/documents');
		env.DATA_DIR = '/volume/dokumente';
		expect(documentsDirectory()).toBe('/volume/dokumente');
	});
});

describe('openFileStorage', () => {
	it('stores a stream and reads it back with its content type and size', async () => {
		const key = storageKey('a', 'doc-1');
		await storage.put(key, new Blob(['Hallo']).stream(), 'text/plain');
		const stored = await storage.get(key);
		expect(stored).toMatchObject({ contentType: 'text/plain', size: 5 });
		expect(await text(stored!.body)).toBe('Hallo');
		expect(await storage.get(storageKey('a', 'doc-2'))).toBeUndefined();
	});

	it('falls back to a generic content type when its file is gone or empty', async () => {
		const key = storageKey('a', 'doc-1');
		await storage.put(key, new Uint8Array([1, 2, 3]), '');
		expect((await storage.get(key))!.contentType).toBe('application/octet-stream');
		await unlink(join(root, 'a', 'doc-1.type'));
		expect((await storage.get(key))!.contentType).toBe('application/octet-stream');
	});

	it('removes the account directory with its last file only', async () => {
		await storage.put(storageKey('a', 'doc-1'), new Uint8Array([1]), 'application/pdf');
		await storage.put(storageKey('a', 'doc-2'), new Uint8Array([2]), 'application/pdf');
		await storage.delete(storageKey('a', 'doc-1'));
		expect(await readdir(join(root, 'a'))).toEqual(['doc-2', 'doc-2.type']);
		await storage.delete(storageKey('a', 'doc-2'));
		expect(await readdir(root)).toEqual([]);
		// Deleting a missing key is fine.
		await storage.delete(storageKey('a', 'doc-3'));
	});

	it('deletes every file of an account and nothing of another', async () => {
		await storage.put(storageKey('a', 'doc-1'), new Uint8Array([1]), 'application/pdf');
		await storage.put(storageKey('b', 'doc-1'), new Uint8Array([1]), 'application/pdf');
		await storage.deletePrefix(accountPrefix('a'));
		expect(await readdir(root)).toEqual(['b']);
	});

	it('refuses keys and prefixes that leave the directory', async () => {
		await expect(storage.put('../outside', new Uint8Array([1]), 'text/plain')).rejects.toThrow(
			'Invalid storage key'
		);
		await expect(storage.get('a/\0doc')).rejects.toThrow('Invalid storage key');
		await expect(storage.deletePrefix('a')).rejects.toThrow('Invalid storage prefix');
		await expect(storage.deletePrefix('./')).rejects.toThrow('Invalid storage prefix');
		await expect(storage.deletePrefix('../')).rejects.toThrow('Invalid storage key');
	});
});

describe('getStorage', () => {
	it('opens the file storage of the node target once', async () => {
		const first = await getStorage();
		expect(Object.keys(first).sort()).toEqual(['delete', 'deletePrefix', 'get', 'put']);
		expect(await getStorage()).toBe(first);
	});
});
