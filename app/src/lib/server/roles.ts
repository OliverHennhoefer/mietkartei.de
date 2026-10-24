import { error, type RequestEvent } from '@sveltejs/kit';
import { actionName } from './billing';

// Viewers (Lesezugriff) read the account but change nothing. The hook refuses their writes here,
// in one place, so no form action has to check the role and new pages are covered at once. The
// API caps their keys to reading, see authenticateApiKey.

/** Paths that accept every POST of a viewer: signing out, their own calendar link and API keys. */
const viewerPaths = new Set([
	'/abmelden',
	'/einstellungen/kalender',
	'/einstellungen/api-schluessel'
]);

/**
 * The pages of reset, address confirmation, registration and invitation links, which secure the
 * sign-in or have nothing to do with the signed-in account.
 */
const viewerPrefixes = [
	'/passwort-zuruecksetzen/',
	'/e-mail-bestaetigen/',
	'/registrieren/',
	'/einladung/'
];

/** Form actions a viewer may use: their own name, address and password. */
const viewerActions = new Map([['/einstellungen/profil', new Set(['profile', 'password'])]]);

/** Pages that only hold a form to create or edit something, e.g. /objekte/neu. */
const formPage = /\/(neu|bearbeiten)$/;

export const VIEWER_MESSAGE = 'Du hast Lesezugriff auf dieses Konto und kannst nichts ändern.';

/** Whether a viewer's request has to be refused: a write outside the paths above or a form page. */
export function refusesViewer(method: string, pathname: string, action = 'default'): boolean {
	const path = pathname.replace(/\/$/, '') || '/';
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return formPage.test(path);
	if (viewerPaths.has(path)) return false;
	if (viewerPrefixes.some((prefix) => path.startsWith(prefix))) return false;
	return !viewerActions.get(path)?.has(action);
}

/** Called by the hook for every signed-in request. */
export function enforceRole(event: RequestEvent): void {
	if (event.locals.user?.role !== 'viewer') return;
	const action = actionName(event.url.searchParams);
	if (refusesViewer(event.request.method, event.url.pathname, action)) error(403, VIEWER_MESSAGE);
}
