import { DEMO } from '$app/env/private';
import type { RequestHandler } from './$types';

// The app holds private data and stays out of search engines; every response also carries
// X-Robots-Tag: noindex (see hooks.server.ts). The sign-in page, which the homepage links to, may
// be crawled so that search engines see that noindex. The demo's start page is the one public page.
const APP = 'User-agent: *\nAllow: /anmelden\nDisallow: /\n';
const DEMO_SITE = 'User-agent: *\nAllow: /$\nAllow: /demo\nDisallow: /\n';

export const GET: RequestHandler = () =>
	new Response(DEMO ? DEMO_SITE : APP, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
