import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const env = vi.hoisted(() => ({ DEMO: false }));
vi.mock('$app/env/private', () => env);

beforeEach(() => {
	env.DEMO = false;
});

async function robots() {
	return (await GET({} as never)).text();
}

describe('robots.txt', () => {
	it('closes the app to crawlers except for the sign-in page', async () => {
		expect(await robots()).toBe('User-agent: *\nAllow: /anmelden\nDisallow: /\n');
	});

	it('opens only the start page of the demo', async () => {
		env.DEMO = true;
		expect(await robots()).toBe('User-agent: *\nAllow: /$\nAllow: /demo\nDisallow: /\n');
	});
});
