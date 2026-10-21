import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseApproval, parseDelivered } from '#lib/forms/statements.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import {
	approveStatement,
	createCorrection,
	deleteDraft,
	getStatement,
	setDelivered,
	statementExists
} from '#lib/server/statements.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const view = await getStatement(locals.db, accountId, params.id);
	if (!view) error(404, 'Diese Abrechnung gibt es nicht.');
	return { view, today: today() };
};

/** Every action answers 404 for a statement of another account before it reads the form. */
async function requireStatement(locals: App.Locals, id: string): Promise<void> {
	if (!(await statementExists(locals.db, requireAccount(locals), id))) {
		error(404, 'Diese Abrechnung gibt es nicht.');
	}
}

export const actions: Actions = {
	approve: async ({ request, locals, params }) => {
		await requireStatement(locals, params.id);
		const result = parseApproval(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const approved = await approveStatement(
			locals.db,
			auditContext(locals),
			params.id,
			result.data
		);
		if (!approved.ok) return fail(400, { message: approved.message });
		return { approved: true };
	},

	delete: async ({ locals, params }) => {
		await requireStatement(locals, params.id);
		const deleted = await deleteDraft(locals.db, auditContext(locals), params.id);
		if (!deleted) return fail(400, { message: 'Nur ein Entwurf kann gelöscht werden.' });
		redirect(303, '/betriebskosten');
	},

	correct: async ({ locals, params }) => {
		await requireStatement(locals, params.id);
		const correction = await createCorrection(locals.db, auditContext(locals), params.id);
		if (!correction.ok) return fail(400, { message: correction.message });
		redirect(303, `/betriebskosten/abrechnungen/${correction.id}`);
	},

	deliver: async ({ request, locals, params }) => {
		await requireStatement(locals, params.id);
		const result = parseDelivered(await request.formData());
		if (!result.ok) {
			return fail(400, { message: 'Bitte gib ein gültiges Datum der Zustellung an.' });
		}
		const done = await setDelivered(
			locals.db,
			auditContext(locals),
			params.id,
			result.data.leaseId,
			result.data.deliveredOn
		);
		if (!done.ok) return fail(400, { message: done.message });
		return { delivered: result.data.leaseId, reversed: done.reversed };
	}
};
