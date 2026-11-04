import { error, redirect } from '@sveltejs/kit';
import { dismissHints, isHintKey, MAX_HINT_KEYS, restoreHints } from '#lib/server/hints.ts';
import { requireUser } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// The x of a Hinweis (Hints.svelte) and "wieder anzeigen" below closed ones. The page sends it
// with fetch and hides the Hinweis right away; without JavaScript the form posts here and comes
// back to the page. Viewers may use it too: it changes only their own view.

/** The page to return to: a path of this app, never another site. */
function backPath(value: FormDataEntryValue | null): string {
	return typeof value === 'string' && value.startsWith('/') && !/^\/[/\\]/.test(value)
		? value
		: '/';
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const form = await request.formData();
	const keys = [...new Set(form.getAll('key'))];
	if (keys.length === 0 || keys.length > MAX_HINT_KEYS || !keys.every(isHintKey)) {
		error(400, 'Diesen Hinweis gibt es nicht.');
	}
	if (form.get('restore')) await restoreHints(locals.db, user.id, keys);
	else await dismissHints(locals.db, user, keys);
	if (request.headers.get('accept')?.includes('application/json')) {
		return new Response(null, { status: 204 });
	}
	redirect(303, backPath(form.get('back')));
};
