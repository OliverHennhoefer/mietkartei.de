import { describe, expect, it } from 'vitest';
import { createMemoryLimiter } from './memory';

describe('createMemoryLimiter', () => {
	it('allows the limit per window and refuses the rest', async () => {
		let time = 0;
		const limiter = createMemoryLimiter(3, 60_000, () => time);
		const results = [];
		for (let i = 0; i < 5; i++) results.push(await limiter.limit('1.2.3.4'));
		expect(results).toEqual([true, true, true, false, false]);

		time = 60_000;
		expect(await limiter.limit('1.2.3.4')).toBe(true);
	});

	it('counts each key on its own', async () => {
		const limiter = createMemoryLimiter(1, 60_000, () => 0);
		expect(await limiter.limit('a')).toBe(true);
		expect(await limiter.limit('b')).toBe(true);
		expect(await limiter.limit('a')).toBe(false);
	});
});
