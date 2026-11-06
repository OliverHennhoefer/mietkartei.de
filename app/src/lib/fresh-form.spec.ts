import { describe, expect, it, vi } from 'vitest';

type Callback = (navigation: { type: string }) => void;
const callbacks: Callback[] = [];
vi.mock('$app/navigation', () => ({
	afterNavigate: (callback: Callback) => callbacks.push(callback)
}));

const { FreshForm } = await import('./fresh-form.svelte.ts');

describe('FreshForm', () => {
	it('counts every navigation after the first visit', () => {
		const fresh = new FreshForm();
		expect(fresh.visit).toBe(0);
		const navigated = callbacks.at(-1)!;
		navigated({ type: 'enter' });
		expect(fresh.visit).toBe(0);
		navigated({ type: 'goto' });
		navigated({ type: 'form' });
		expect(fresh.visit).toBe(2);
	});
});
