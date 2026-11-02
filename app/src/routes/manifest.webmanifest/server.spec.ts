import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const env = vi.hoisted(() => ({ DEMO: false }));
vi.mock('$app/env/private', () => env);

beforeEach(() => {
	env.DEMO = false;
});

async function manifest() {
	const response = await GET({} as never);
	return { response, body: await response.json() };
}

describe('manifest.webmanifest', () => {
	it('describes the app for the home screen, with its icons', async () => {
		const { response, body } = await manifest();
		expect(response.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(body).toMatchObject({
			id: '/',
			name: 'mietkartei',
			short_name: 'mietkartei',
			lang: 'de',
			start_url: '/',
			display: 'standalone'
		});
		expect(body.icons).toMatchObject([
			{ sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ sizes: '512x512', type: 'image/png', purpose: 'any' },
			{ sizes: '512x512', type: 'image/png', purpose: 'maskable' }
		]);
		for (const icon of body.icons) expect(icon.src).toMatch(/app-icon-(192|512)\.png/);
	});

	it('names the demo as such', async () => {
		env.DEMO = true;
		expect((await manifest()).body.name).toBe('mietkartei Demo');
	});
});
