// The service worker only shows the app's Mitteilungen and opens the app when one is tapped; it
// caches nothing, so every page still comes fresh from the server. A message is a PushMessage of
// #lib/server/web-push.ts, encrypted for this browser by the server.

import badge from '../../../assets/brand/notification-badge.png?no-inline';
import icon from '../../../assets/brand/app-icon-192.png?no-inline';

const worker = self as unknown as ServiceWorkerGlobalScope;

type Message = { title: string; body: string; path: string; tag: string };

function parse(data: PushMessageData | null): Message {
	const fallback = { title: 'mietkartei', body: '', path: '/aufgaben', tag: 'mietkartei' };
	try {
		const value = data?.json() as Partial<Message> | undefined;
		return {
			title: typeof value?.title === 'string' ? value.title : fallback.title,
			body: typeof value?.body === 'string' ? value.body : fallback.body,
			path: typeof value?.path === 'string' ? value.path : fallback.path,
			tag: typeof value?.tag === 'string' ? value.tag : fallback.tag
		};
	} catch {
		return fallback;
	}
}

/** A page of the app; anything leading elsewhere opens the Aufgaben instead. */
function appUrl(path: unknown): string {
	const origin = worker.location.origin;
	if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
		return `${origin}/aufgaben`;
	}
	const url = new URL(path, origin);
	return url.origin === origin ? url.href : `${origin}/aufgaben`;
}

worker.addEventListener('install', () => {
	void worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(worker.clients.claim());
});

worker.addEventListener('push', (event) => {
	const message = parse(event.data);
	event.waitUntil(
		worker.registration.showNotification(message.title, {
			body: message.body,
			tag: message.tag,
			icon,
			badge,
			lang: 'de',
			data: { path: message.path }
		})
	);
});

worker.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = appUrl((event.notification.data as { path?: unknown } | null)?.path);
	event.waitUntil(
		(async () => {
			const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const open = windows.find((client) => new URL(client.url).origin === worker.location.origin);
			// navigate only works on a window this worker controls; otherwise a new one opens.
			if (open && (await open.navigate(url).then(Boolean, () => false))) {
				await open.focus();
				return;
			}
			await worker.clients.openWindow(url);
		})()
	);
});
