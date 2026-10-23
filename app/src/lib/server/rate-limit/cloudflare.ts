import { env } from 'cloudflare:workers';
import type { RateLimiter } from './index';

export type LimiterBinding = 'AUTH_LIMITER' | 'API_LIMITER';

/** A rate limit binding; its limit and period are set in wrangler.jsonc. */
export function openCloudflareLimiter(name: LimiterBinding = 'AUTH_LIMITER'): RateLimiter {
	const binding = env[name];
	if (!binding) throw new Error(`The rate limit binding "${name}" is not configured`);
	return {
		async limit(key) {
			const { success } = await binding.limit({ key });
			return success;
		}
	};
}
