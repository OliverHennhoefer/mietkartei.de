import { fail } from '@sveltejs/kit';
import { DEMO, HOSTED, ORIGIN } from '$app/env/private';
import { getDeadlineMail, setDeadlineMail } from '#lib/server/deadline-mails.ts';
import type { NotificationChannelKind } from '#lib/server/db/schema.ts';
import {
	addChannel,
	getNotificationSettings,
	MAX_CHANNELS,
	MAX_FAILURES,
	NOTIFICATION_HOURS,
	pushKey,
	removeChannel,
	setNotificationTiming,
	testChannel,
	type ChannelError
} from '#lib/server/notifications.ts';
import { auditContext, requireUser } from '#lib/server/session.ts';
import { deviceLabel } from '#lib/server/web-push.ts';
import type { Actions, PageServerLoad } from './$types';

// Benachrichtigungen of the signed-in user: the hour and days of the Hinweise, their channels
// (mail, Mitteilungen of a browser, webhooks) with a test and the history of sends, and the weekly
// Fristenübersicht.
// Every user sets their own; nothing here changes the landlord's data.

/** The address the links in mails and pushes lead to: the configured one, or the app's. */
function linkOrigin(url: URL): string {
	return ORIGIN ? new URL(ORIGIN).origin : url.origin;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const [settings, mail, key] = await Promise.all([
		getNotificationSettings(locals.db, user.id),
		getDeadlineMail(locals.db, user.id),
		pushKey()
	]);
	return {
		...settings,
		email: user.email,
		deadlineMail: { on: mail.origin !== null, sentOn: mail.sentOn },
		hours: NOTIFICATION_HOURS,
		maxChannels: MAX_CHANNELS,
		maxFailures: MAX_FAILURES,
		allowHttp: !HOSTED,
		demo: DEMO,
		// The demo shows the card, but sends nothing and so needs no key.
		push: { key: key ?? null, offered: key !== undefined || DEMO }
	};
};

const channelErrors: Record<ChannelError, string> = {
	limit: `Du hast schon ${MAX_CHANNELS} Kanäle. Entferne einen, um einen neuen hinzuzufügen.`,
	'email-exists': 'Hinweise per E-Mail sind schon eingeschaltet.',
	url: 'Diese Adresse passt nicht.',
	'push-off': 'Mitteilungen sind auf diesem Server nicht eingerichtet.'
};

const kinds = new Set<NotificationChannelKind>(['email', 'webhook']);

export const actions: Actions = {
	timing: async ({ locals, request }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		const hour = Number(form.get('hour'));
		if (!Number.isInteger(hour) || hour < NOTIFICATION_HOURS.min || hour > NOTIFICATION_HOURS.max) {
			return fail(400, { refused: 'Wähle eine Uhrzeit zwischen 6 und 21 Uhr.' });
		}
		await setNotificationTiming(locals.db, user.id, hour, form.get('weekends') === 'on');
		return { timingSaved: true };
	},

	add: async ({ locals, request, url }) => {
		const form = await request.formData();
		const kind = String(form.get('kind'));
		if (!kinds.has(kind as NotificationChannelKind)) {
			return fail(400, { refused: 'Diesen Kanal gibt es nicht.' });
		}
		const result = await addChannel(
			locals.db,
			auditContext(locals),
			{
				kind: kind as NotificationChannelKind,
				url: String(form.get('url') ?? ''),
				urgentOnly: form.get('urgentOnly') === 'on',
				details: form.get('details') === 'on'
			},
			linkOrigin(url),
			!HOSTED
		);
		if (!result.ok) {
			return fail(400, { refused: channelErrors[result.reason], kind, url: form.get('url') });
		}
		// The only time the webhook's secret is shown; the receiver checks requests with it.
		return { added: kind, secret: result.secret };
	},

	// The Mitteilungen of the browser the form comes from; a test goes out right away, so the user
	// sees at once that it works.
	push: async ({ locals, request }) => {
		const user = requireUser(locals);
		if (DEMO) return fail(400, { refused: 'In der Demo werden keine Hinweise verschickt.' });
		const form = await request.formData();
		const result = await addChannel(
			locals.db,
			auditContext(locals),
			{
				kind: 'push',
				subscription: {
					endpoint: String(form.get('endpoint') ?? ''),
					keys: { p256dh: String(form.get('p256dh') ?? ''), auth: String(form.get('auth') ?? '') }
				},
				label: deviceLabel(request.headers.get('user-agent') ?? ''),
				urgentOnly: form.get('urgentOnly') === 'on',
				details: form.get('details') === 'on'
			},
			linkOrigin(new URL(request.url)),
			!HOSTED
		);
		if (!result.ok) {
			return fail(400, {
				refused:
					result.reason === 'url'
						? 'Der Browser hat keine gültige Anmeldung für Mitteilungen geliefert.'
						: channelErrors[result.reason]
			});
		}
		const test = await testChannel(locals.db, auditContext(locals), result.id, user);
		if (!test?.ok) {
			return fail(502, {
				refused: `Eingerichtet, aber die Testmitteilung ist nicht angekommen: ${test?.error ?? 'Fehler'}`
			});
		}
		return { added: 'push', tested: true };
	},

	remove: async ({ locals, request }) => {
		const id = String((await request.formData()).get('channelId'));
		if (!(await removeChannel(locals.db, auditContext(locals), id))) {
			return fail(404, { refused: 'Diesen Kanal gibt es nicht mehr.' });
		}
		return { removed: true };
	},

	test: async ({ locals, request }) => {
		const user = requireUser(locals);
		// Visitors of the demo could otherwise make it post to any address.
		if (DEMO) return fail(400, { refused: 'In der Demo werden keine Hinweise verschickt.' });
		const id = String((await request.formData()).get('channelId'));
		const result = await testChannel(locals.db, auditContext(locals), id, user);
		if (!result) return fail(404, { refused: 'Diesen Kanal gibt es nicht mehr.' });
		if (!result.ok) {
			return fail(502, { refused: `Der Test ist nicht angekommen: ${result.error ?? 'Fehler'}` });
		}
		return { tested: true };
	},

	mail: async ({ locals, request, url }) => {
		const user = requireUser(locals);
		const on = (await request.formData()).get('on') === 'true';
		await setDeadlineMail(locals.db, user.id, on ? linkOrigin(url) : null);
		return { mailSaved: on };
	}
};
