import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openD1 } from './db/d1';
import { API_LIMIT, API_PERIOD_SECONDS, AUTH_LIMIT, AUTH_PERIOD_SECONDS } from './rate-limit';
import { openCloudflareLimiter } from './rate-limit/cloudflare';
import { openR2 } from './storage/r2';

// The adapters of the cloudflare target read their bindings from `cloudflare:workers`, which
// only workerd provides; here it is a stub. The end-to-end tests on workerd run them for real,
// but neither the R2 listing in pages of 1000 nor wrangler.jsonc drifting from the code shows
// up there.

const bindings = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('cloudflare:workers', () => bindings);

beforeEach(() => {
	bindings.env = {};
});

/** wrangler.jsonc without its comment lines; it has no comments after values. */
function wranglerConfig() {
	const text = readFileSync('wrangler.jsonc', 'utf8');
	return JSON.parse(
		text
			.split('\n')
			.filter((line) => !line.trim().startsWith('//'))
			.join('\n')
	);
}

/** An R2 bucket in memory that lists at most `limit` keys per call, like R2. */
function fakeBucket(keys: string[]) {
	const stored = new Map<string, Uint8Array>(
		keys.map((key) => [key, new TextEncoder().encode(key)])
	);
	const types = new Map<string, string>();
	const calls = { list: 0, delete: 0 };
	return {
		calls,
		stored,
		async put(key: string, body: Uint8Array, options: { httpMetadata: { contentType: string } }) {
			stored.set(key, body);
			types.set(key, options.httpMetadata.contentType);
		},
		async get(key: string) {
			const body = stored.get(key);
			if (!body) return null;
			const contentType = types.get(key);
			return {
				body: new Response(body as Uint8Array<ArrayBuffer>).body,
				size: body.length,
				httpMetadata: contentType ? { contentType } : {}
			};
		},
		async delete(key: string | string[]) {
			calls.delete++;
			for (const one of Array.isArray(key) ? key : [key]) stored.delete(one);
		},
		async list({ prefix, limit }: { prefix: string; limit: number }) {
			calls.list++;
			const matching = [...stored.keys()].filter((key) => key.startsWith(prefix)).sort();
			return {
				objects: matching.slice(0, limit).map((key) => ({ key })),
				truncated: matching.length > limit
			};
		}
	};
}
describe('R2 storage', () => {
	it('stores, reads and deletes a document with its type', async () => {
		const bucket = fakeBucket([]);
		bindings.env = { DOCUMENTS: bucket };
		const storage = openR2();
		await storage.put('a/1', new TextEncoder().encode('%PDF'), 'application/pdf');
		const read = await storage.get('a/1');
		expect(read).toMatchObject({ contentType: 'application/pdf', size: 4 });
		expect(await new Response(read!.body).text()).toBe('%PDF');
		await storage.delete('a/1');
		expect(await storage.get('a/1')).toBeUndefined();
	});

	it('falls back to a generic type for an object stored without one', async () => {
		bindings.env = { DOCUMENTS: fakeBucket(['a/alt']) };
		expect(await openR2().get('a/alt')).toMatchObject({ contentType: 'application/octet-stream' });
	});

	it('deletes a prefix in pages of 1000, without touching other accounts', async () => {
		const own = Array.from({ length: 2500 }, (_, index) => `a/${String(index).padStart(4, '0')}`);
		const bucket = fakeBucket([...own, 'b/1', 'ab/1']);
		bindings.env = { DOCUMENTS: bucket };
		await openR2().deletePrefix('a/');
		expect([...bucket.stored.keys()].sort()).toEqual(['ab/1', 'b/1']);
		expect(bucket.calls).toEqual({ list: 3, delete: 3 });
	});

	it('names the missing binding', () => {
		expect(() => openR2()).toThrow('"DOCUMENTS"');
	});
});

describe('rate limit binding', () => {
	it('passes the key to the binding and its answer back', async () => {
		const limit = vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'auth:blocked' }));
		bindings.env = { AUTH_LIMITER: { limit } };
		const limiter = openCloudflareLimiter();
		expect(await limiter.limit('auth:10.0.0.1')).toBe(true);
		expect(await limiter.limit('auth:blocked')).toBe(false);
		expect(limit).toHaveBeenCalledWith({ key: 'auth:10.0.0.1' });
	});

	it('opens the binding it is asked for', async () => {
		const limit = vi.fn(async () => ({ success: false }));
		bindings.env = { AUTH_LIMITER: { limit: vi.fn() }, API_LIMITER: { limit } };
		expect(await openCloudflareLimiter('API_LIMITER').limit('key:1')).toBe(false);
		expect(limit).toHaveBeenCalledWith({ key: 'key:1' });
	});

	it('names the missing binding', () => {
		expect(() => openCloudflareLimiter()).toThrow('"AUTH_LIMITER"');
		expect(() => openCloudflareLimiter('API_LIMITER')).toThrow('"API_LIMITER"');
	});
});

describe('D1', () => {
	it('names the missing binding', () => {
		expect(() => openD1()).toThrow('"DB"');
	});
});

describe('wrangler.jsonc', () => {
	it('binds what the adapters read', () => {
		const config = wranglerConfig();
		expect(config.d1_databases.map((db: { binding: string }) => db.binding)).toContain('DB');
		expect(config.r2_buckets.map((bucket: { binding: string }) => bucket.binding)).toContain(
			'DOCUMENTS'
		);
		expect(config.ratelimits.map((limit: { name: string }) => limit.name)).toEqual([
			'AUTH_LIMITER',
			'API_LIMITER'
		]);
	});

	it('limits sign-in attempts as the node target does', () => {
		const limiter = wranglerConfig().ratelimits.find(
			(limit: { name: string }) => limit.name === 'AUTH_LIMITER'
		);
		expect(limiter.simple).toEqual({ limit: AUTH_LIMIT, period: AUTH_PERIOD_SECONDS });
	});

	it('limits API calls as the node target does', () => {
		const limiter = wranglerConfig().ratelimits.find(
			(limit: { name: string }) => limit.name === 'API_LIMITER'
		);
		expect(limiter.simple).toEqual({ limit: API_LIMIT, period: API_PERIOD_SECONDS });
	});

	it('migrates D1 from the same folder as the SQLite database', () => {
		const [db] = wranglerConfig().d1_databases;
		expect(db.migrations_dir).toBe('drizzle');
	});

	it('gives the demo the same bindings and turns it on only there', () => {
		const config = wranglerConfig();
		const demo = config.env.demo;
		expect(config.vars.DEMO).toBeUndefined();
		expect(demo.vars.DEMO).toBe('true');
		expect(demo.vars.MAIL_TRANSPORT).toBe('outbox');
		expect(demo.d1_databases[0]).toMatchObject({ binding: 'DB', migrations_dir: 'drizzle' });
		expect(demo.d1_databases[0].database_id).not.toBe(config.d1_databases[0].database_id);
		expect(demo.r2_buckets[0].binding).toBe('DOCUMENTS');
		expect(demo.r2_buckets[0].bucket_name).not.toBe(config.r2_buckets[0].bucket_name);
		expect(demo.ratelimits[0]).toMatchObject({
			name: 'AUTH_LIMITER',
			simple: { limit: AUTH_LIMIT, period: AUTH_PERIOD_SECONDS }
		});
	});
});
