import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeWranglerConfig, parseJsonc } from '../../../../scripts/selfhost-update.mjs';

// The update of a self-hosted copy on Cloudflare keeps what Cloudflare gave the copy.

describe('wrangler.jsonc of a self-hosted copy after an update', () => {
	const upstream = parseJsonc(readFileSync('../wrangler.jsonc', 'utf8'));
	const [database] = upstream.d1_databases ?? [];
	const buckets = upstream.r2_buckets ?? [];

	it('reads the comments and trailing commas of wrangler.jsonc', () => {
		expect(parseJsonc('{\n// a\n"a": "x//y", /* b */ "b": [1, 2,],\n}')).toEqual({
			a: 'x//y',
			b: [1, 2]
		});
		expect(database.binding).toBe('DB');
	});

	it('keeps the name and the ids of the copy and takes the rest from upstream', () => {
		const own = {
			...upstream,
			name: 'meine-mietkartei',
			vars: { MAIL_TRANSPORT: 'alt' },
			d1_databases: [{ ...database, database_id: 'd1-id', database_name: 'mk' }],
			r2_buckets: [{ binding: 'DOCUMENTS', bucket_name: 'meine-dokumente' }],
			ratelimits: []
		};
		const merged = mergeWranglerConfig(own, upstream);
		expect(merged.name).toBe('meine-mietkartei');
		expect(merged.vars).toEqual(upstream.vars);
		expect(merged.ratelimits).toEqual(upstream.ratelimits);
		expect(merged.d1_databases).toEqual([
			{ ...database, database_id: 'd1-id', database_name: 'mk' }
		]);
		expect(merged.r2_buckets).toEqual([{ binding: 'DOCUMENTS', bucket_name: 'meine-dokumente' }]);
		expect(upstream.name).toBe('mietkartei');
	});

	it('adds a binding new upstream as it is there', () => {
		const withMap = {
			...upstream,
			r2_buckets: [...buckets, { binding: 'MAP', bucket_name: 'mietkartei-map' }]
		};
		expect(mergeWranglerConfig(upstream, withMap).r2_buckets).toEqual(withMap.r2_buckets);
	});
});
