import { json } from '@sveltejs/kit';
import { authorizationServerMetadata } from '#lib/server/oauth.ts';
import type { RequestHandler } from './$types';

// RFC 8414, at /.well-known/oauth-authorization-server and below it: the OAuth endpoints. Public,
// also to pages of other sites.

export const GET: RequestHandler = ({ url }) =>
	json(authorizationServerMetadata(url.origin), {
		headers: { 'access-control-allow-origin': '*' }
	});
