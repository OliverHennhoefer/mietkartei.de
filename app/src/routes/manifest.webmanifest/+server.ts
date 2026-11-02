import { DEMO } from '$app/env/private';
import icon192 from '../../../../assets/brand/app-icon-192.png?no-inline';
import icon512 from '../../../../assets/brand/app-icon-512.png?no-inline';
import type { RequestHandler } from './$types';

// The web app manifest: with it the app can be added to the home screen and opens there in a
// window of its own, which iPhones require before a web app may show Mitteilungen. Browsers fetch
// it without the session cookie, so it is public and holds nothing about the user.

export const GET: RequestHandler = () =>
	new Response(
		JSON.stringify({
			id: '/',
			name: DEMO ? 'mietkartei Demo' : 'mietkartei',
			short_name: 'mietkartei',
			description: 'Mieten, Fristen, Bankumsätze und Betriebskosten im Blick.',
			lang: 'de',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			background_color: '#ffffff',
			theme_color: '#ffffff',
			// The mark keeps to the inner circle, so launchers may cut the square to any shape.
			icons: [
				{ src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
				{ src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
				{ src: icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
			]
		}),
		{
			headers: {
				'Content-Type': 'application/manifest+json; charset=utf-8',
				'Cache-Control': 'public, max-age=3600'
			}
		}
	);
