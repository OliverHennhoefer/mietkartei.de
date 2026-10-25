import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from './index';
import { accounts } from './schema';

const env = vi.hoisted(() => ({ DATABASE_PATH: '' }));
vi.mock('$app/env/private', () => env);

let root: string | undefined;

afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});

describe('getDatabase', () => {
	it('opens the SQLite file once per process, in a new folder, with the schema migrated', async () => {
		root = await mkdtemp(join(tmpdir(), 'mietkartei-db-'));
		env.DATABASE_PATH = join(root, 'data', 'mietkartei.db');
		const db = await getDatabase();
		expect(existsSync(env.DATABASE_PATH)).toBe(true);
		expect(await db.select().from(accounts)).toEqual([]);
		expect(await getDatabase()).toBe(db);
	});
});
