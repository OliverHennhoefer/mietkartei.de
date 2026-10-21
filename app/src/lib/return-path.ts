// A ?return=<path> parameter sends the user back to where they came from after a form. It must
// stay inside the app: browsers read `/\evil.example` as `//evil.example`, and drop tabs and line
// breaks before they parse, so a prefix check alone is not enough.

const BASE = 'http://app.invalid';

/**
 * The path and query of `value` when it names a page of this app, else null. The value is
 * resolved the way a browser resolves a link, and refused when the result leaves the app.
 */
export function returnPath(value: string | null | undefined): string | null {
	if (!value || !value.startsWith('/') || value.includes('\\')) return null;
	let resolved: URL;
	try {
		resolved = new URL(value, BASE);
	} catch {
		return null;
	}
	if (resolved.origin !== BASE || resolved.pathname.startsWith('//')) return null;
	return `${resolved.pathname}${resolved.search}`;
}
