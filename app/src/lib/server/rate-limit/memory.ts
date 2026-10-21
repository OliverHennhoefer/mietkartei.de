import type { RateLimiter } from './index';

/** Above this many keys, expired windows are dropped so the map cannot grow without bound. */
const PRUNE_ABOVE = 10_000;

/** A fixed window per key: at most `limit` attempts per `periodMs`, counted in this process. */
export function createMemoryLimiter(
	limit: number,
	periodMs: number,
	now: () => number = Date.now
): RateLimiter {
	const windows = new Map<string, { count: number; endsAt: number }>();
	return {
		async limit(key) {
			const time = now();
			if (windows.size > PRUNE_ABOVE) {
				for (const [stored, window] of windows) if (window.endsAt <= time) windows.delete(stored);
			}
			const window = windows.get(key);
			if (!window || window.endsAt <= time) {
				windows.set(key, { count: 1, endsAt: time + periodMs });
				return true;
			}
			window.count += 1;
			return window.count <= limit;
		}
	};
}
