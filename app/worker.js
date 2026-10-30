// The worker of the cloudflare target: the app as built by adapter-cloudflare, plus a handler for
// the cron trigger of wrangler.jsonc. vite.config.ts moves the adapter's _worker.js aside and puts
// this file in its place, so the import below is relative to .svelte-kit/cloudflare/.
// The trigger starts the scheduled jobs (the weekly Fristenübersicht) through the app's own
// /api/jobs, with a token only this isolate knows; see src/lib/server/jobs.ts.
import app from '../cloudflare-tmp/app-worker.js';

export default {
	fetch: app.fetch,
	async scheduled(controller, env, ctx) {
		const token = [...crypto.getRandomValues(new Uint8Array(32))]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		globalThis.__mietkartei_job_token = token;
		// The app takes its origin from the first request of an isolate and only uses it to read
		// its own files, which it does not; the host here is never asked.
		const request = new Request('https://jobs.invalid/api/jobs', {
			method: 'POST',
			// Not a form post, so the CSRF check of the hook lets it through.
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: '{}'
		});
		ctx.waitUntil(
			app.fetch(request, env, ctx).then((response) => {
				if (!response.ok) console.error(`[jobs] /api/jobs answered ${response.status}`);
			})
		);
	}
};
