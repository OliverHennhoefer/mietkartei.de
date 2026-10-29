// Scheduled work, such as the weekly Fristenübersicht. Neither target can call into the app
// directly: server.js (node) and worker.js (the cron trigger on cloudflare) post to /api/jobs
// instead, with a token they put into globalThis just before. The token never leaves the process,
// so no request from outside can start the jobs.

export const JOB_PATH = '/api/jobs';

/** The key in globalThis; server.js and worker.js use the same. */
const TOKEN_KEY = '__mietkartei_job_token';

/** Whether the request comes from server.js or worker.js of this process. */
export function isJobRequest(request: Request): boolean {
	const token = (globalThis as Record<string, unknown>)[TOKEN_KEY];
	return (
		typeof token === 'string' &&
		token.length >= 32 &&
		request.headers.get('authorization') === `Bearer ${token}`
	);
}
