import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The service worker runs in the browser; here it gets a stand-in for its scope, and each test
// fires the events the browser would.

type Listener = (event: unknown) => void;

const listeners = new Map<string, Listener>();
const scope = {
	location: { origin: 'https://app.example.org' },
	addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
	skipWaiting: vi.fn(async () => undefined),
	clients: {
		claim: vi.fn(async () => undefined),
		matchAll: vi.fn(async (): Promise<unknown[]> => []),
		openWindow: vi.fn(async () => null)
	},
	registration: { showNotification: vi.fn(async () => undefined) }
};

beforeAll(async () => {
	vi.stubGlobal('self', scope);
	await import('./index');
});

beforeEach(() => {
	vi.clearAllMocks();
	scope.clients.matchAll.mockResolvedValue([]);
});

/** Fires an event and waits for what it hands to waitUntil. */
async function fire(type: string, event: object = {}) {
	const pending: Promise<unknown>[] = [];
	listeners.get(type)!({
		...event,
		waitUntil: (promise: Promise<unknown>) => pending.push(promise)
	});
	await Promise.all(pending);
}

function push(data: unknown) {
	return fire('push', {
		data:
			data === null
				? null
				: {
						json: () => (typeof data === 'string' ? JSON.parse(data) : data)
					}
	});
}

function click(data: unknown) {
	const close = vi.fn();
	return { close, done: fire('notificationclick', { notification: { close, data } }) };
}

describe('service worker', () => {
	it('takes over at once', async () => {
		await fire('install');
		expect(scope.skipWaiting).toHaveBeenCalledOnce();
		await fire('activate');
		expect(scope.clients.claim).toHaveBeenCalledOnce();
	});

	it('shows a Mitteilung with the path to open', async () => {
		await push({
			title: 'Fristen: 1 neu',
			body: '10.11.2026: Aufgabe',
			path: '/aufgaben',
			tag: 'h'
		});
		expect(scope.registration.showNotification).toHaveBeenCalledWith('Fristen: 1 neu', {
			body: '10.11.2026: Aufgabe',
			tag: 'h',
			icon: expect.stringMatching(/app-icon-192/),
			badge: expect.stringMatching(/notification-badge/),
			lang: 'de',
			data: { path: '/aufgaben' }
		});
	});

	it('shows a plain Mitteilung for a message it cannot read', async () => {
		await push(null);
		await push('not json');
		await push({ title: 7, body: null });
		for (const [title, options] of scope.registration.showNotification.mock.calls as unknown as [
			string,
			{ body: string; tag: string; data: { path: string } }
		][]) {
			expect(title).toBe('mietkartei');
			expect(options).toMatchObject({ body: '', tag: 'mietkartei', data: { path: '/aufgaben' } });
		}
		expect(scope.registration.showNotification).toHaveBeenCalledTimes(3);
	});

	it('opens the path of a tapped Mitteilung in a new window', async () => {
		const { close, done } = click({ path: '/aufgaben?bearbeiten=1' });
		await done;
		expect(close).toHaveBeenCalledOnce();
		expect(scope.clients.openWindow).toHaveBeenCalledWith(
			'https://app.example.org/aufgaben?bearbeiten=1'
		);
	});

	it('opens only pages of the app', async () => {
		for (const path of ['https://evil.example/x', '//evil.example/x', 'aufgaben', 7, undefined]) {
			await click({ path }).done;
		}
		await click(null).done;
		expect(scope.clients.openWindow.mock.calls).toEqual(
			Array.from({ length: 6 }, () => ['https://app.example.org/aufgaben'])
		);
	});

	it('uses a window of the app that is already open', async () => {
		const navigate = vi.fn(async () => ({}));
		const focus = vi.fn(async () => undefined);
		scope.clients.matchAll.mockResolvedValue([
			{ url: 'https://other.example/', navigate: vi.fn(), focus: vi.fn() },
			{ url: 'https://app.example.org/objekte', navigate, focus }
		]);
		await click({ path: '/bank' }).done;
		expect(navigate).toHaveBeenCalledWith('https://app.example.org/bank');
		expect(focus).toHaveBeenCalledOnce();
		expect(scope.clients.openWindow).not.toHaveBeenCalled();
	});

	it('opens a new window when the open one cannot be navigated', async () => {
		scope.clients.matchAll.mockResolvedValue([
			{
				url: 'https://app.example.org/objekte',
				navigate: vi.fn(async () => {
					throw new TypeError('not controlled');
				}),
				focus: vi.fn()
			}
		]);
		await click({ path: '/bank' }).done;
		expect(scope.clients.openWindow).toHaveBeenCalledWith('https://app.example.org/bank');
	});
});
