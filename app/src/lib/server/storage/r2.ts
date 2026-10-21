import { env } from 'cloudflare:workers';
import type { Storage } from './index';

/** Documents in the R2 bucket bound as DOCUMENTS in wrangler.jsonc. */
export function openR2(): Storage {
	const bucket = env.DOCUMENTS;
	if (!bucket) throw new Error('The R2 binding "DOCUMENTS" is not configured in wrangler.jsonc');
	return {
		async put(key, body, contentType) {
			await bucket.put(key, body as unknown as Parameters<typeof bucket.put>[1], {
				httpMetadata: { contentType }
			});
		},
		async get(key) {
			const object = await bucket.get(key);
			if (!object) return undefined;
			return {
				body: object.body as unknown as ReadableStream,
				contentType: object.httpMetadata?.contentType || 'application/octet-stream',
				size: object.size
			};
		},
		async delete(key) {
			await bucket.delete(key);
		},
		async deletePrefix(prefix) {
			// One list and one bulk delete per 1000 objects, not a call per object: each call is a
			// subrequest. Every round lists from the start again, as the last one removed its page.
			for (;;) {
				const listed = await bucket.list({ prefix, limit: 1000 });
				if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key));
				if (!listed.truncated) return;
			}
		}
	};
}
