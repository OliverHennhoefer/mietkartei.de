import { error, type RequestEvent } from '@sveltejs/kit';
import { normalizePath, viewerActions, viewerPaths, viewerPrefixes } from '../viewer-paths';
import { actionName } from './billing';

// Viewers (Lesezugriff) read the account but change nothing. The hook refuses their writes here,
// in one place, so no form action has to check the role and new pages are covered at once. The
// API caps their keys to reading, see authenticateApiKey.

/** Pages that only hold a form to create or edit something, e.g. /objekte/neu. */
const formPage = /\/(neu|bearbeiten)$/;

export const VIEWER_MESSAGE = 'Du hast Lesezugriff auf dieses Konto und kannst nichts ändern.';

/** Whether a viewer's request has to be refused: a write outside viewer-paths.ts, or a form page. */
export function refusesViewer(method: string, pathname: string, action = 'default'): boolean {
	const path = normalizePath(pathname);
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
