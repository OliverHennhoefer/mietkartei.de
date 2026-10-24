// SvelteKit's own CSRF check refuses every form post from another origin or without one. The OAuth
// token endpoint has to take form posts from the servers of other apps, which send no Origin, so
// vite.config.ts turns that check off and the hook runs this one, the same apart from that
// endpoint. The token endpoint needs no protection: it acts on nothing but the code or refresh
// token in the post, and a page of another site cannot read its answer.

/** The content types a plain HTML form can post, plus SvelteKit's binary form data. */
const formTypes = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
]);

const mutating = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Paths that take form posts from anywhere. */
const openPaths = new Set(['/oauth/token']);

/** Whether a request is a form post from another site (or none), which has to be refused. */
export function isCrossSiteForm(request: Request, url: URL): boolean {
	if (!mutating.has(request.method) || openPaths.has(url.pathname)) return false;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
	if (type && !formTypes.has(type)) return false;
	return request.headers.get('origin') !== url.origin;
}
