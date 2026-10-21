import { error, json } from '@sveltejs/kit';
import { E2E } from '$app/env/private';
import { seed } from '#lib/server/e2e-seed.ts';
import type { RequestHandler } from './$types';

/** Seeds test data into the owner's account; see e2e-seed.ts. Only for the end-to-end tests. */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!E2E) error(404, 'Nicht gefunden');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Der Körper ist kein gültiges JSON.' }, { status: 400 });
	}
	const result = await seed(locals.db, body);
	return json(result.body, { status: result.status });
};
