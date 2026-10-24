import { json } from '@sveltejs/kit';
import { protectedResourceMetadata } from '#lib/server/oauth.ts';
import type { RequestHandler } from './$types';

// RFC 9728, at /.well-known/oauth-protected-resource and below it, e.g. …/mcp: where a client
// that got a 401 from /mcp finds the authorization server. Public, also to pages of other sites.

export const GET: RequestHandler = ({ url }) =>
	json(protectedResourceMetadata(url.origin), {
		headers: { 'access-control-allow-origin': '*' }
	});
