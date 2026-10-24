// Where viewers (Lesezugriff) may still write, shared by the hook that refuses all other writes
// (#lib/server/roles.ts) and the layout, which keeps the forms of these pages usable.

/** Paths that accept every POST of a viewer: signing out, their own calendar link and API keys. */
export const viewerPaths = new Set([
	'/abmelden',
	'/einstellungen/kalender',
	'/einstellungen/api-schluessel'
]);

/**
 * The pages of reset, address confirmation, registration and invitation links, which secure the
 * sign-in or have nothing to do with the signed-in account.
 */
export const viewerPrefixes = [
	'/passwort-zuruecksetzen/',
	'/e-mail-bestaetigen/',
	'/registrieren/',
	'/einladung/'
];

/** Form actions a viewer may use: their own name, address and password, and leaving the account. */
export const viewerActions = new Map([
	['/einstellungen/profil', new Set(['profile', 'password'])],
	['/einstellungen/konto', new Set(['leave'])]
]);

/** The path without a trailing slash, as the lists above spell it. */
export function normalizePath(pathname: string): string {
	return pathname.replace(/\/$/, '') || '/';
}

/** Whether a page has forms a viewer may submit, so the layout leaves them as they are. */
export function viewerWritesOn(pathname: string): boolean {
	const path = normalizePath(pathname);
	return (
		viewerPaths.has(path) ||
		viewerActions.has(path) ||
		viewerPrefixes.some((prefix) => path.startsWith(prefix))
	);
}
