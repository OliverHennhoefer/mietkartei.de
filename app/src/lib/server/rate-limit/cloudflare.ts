import { env } from 'cloudflare:workers';
import type { RateLimiter } from './index';

/** The AUTH_LIMITER binding; its limit and period are set in wrangler.jsonc. */
export function openCloudflareLimiter(): RateLimiter {
	const binding = env.AUTH_LIMITER;
	if (!binding) throw new Error('The rate limit binding "AUTH_LIMITER" is not configured');
	return {
		async limit(key) {
			const { success } = await binding.limit({ key });
			return success;
		}
	};
}
