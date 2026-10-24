import { error, fail, redirect } from '@sveltejs/kit';
import { parseDamageReportUpdate } from '#lib/forms/damage-reports.ts';
import {
	createTaskFromReport,
	deleteDamageReport,
	getDamageReport,
	listReportPhotos,
	updateDamageReport
} from '#lib/server/damage-reports.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const MISSING = 'Diese Schadensmeldung gibt es nicht.';

export const load: PageServerLoad = async ({ locals, params }) => {
	const accountId = requireAccount(locals);
	const report = await getDamageReport(locals.db, accountId, params.id);
	if (!report) error(404, MISSING);
	const photos = await listReportPhotos(locals.db, accountId, report.id);
	return {
		report,
		photos: photos.map((photo) => ({ id: photo.id, name: photo.name }))
	};
};

export const actions: Actions = {
	update: async ({ locals, params, request }) => {
		if (!(await getDamageReport(locals.db, requireAccount(locals), params.id))) error(404, MISSING);
		const result = parseDamageReportUpdate(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		if (!(await updateDamageReport(locals.db, auditContext(locals), params.id, result.data))) {
			error(404, MISSING);
		}
		return { saved: true };
	},
	task: async ({ locals, params }) => {
		const created = await createTaskFromReport(locals.db, auditContext(locals), params.id);
		if (!created.ok) error(404, MISSING);
		redirect(303, `/aufgaben/${created.taskId}`);
	},
	delete: async ({ locals, params }) => {
		if (!(await deleteDamageReport(locals.db, auditContext(locals), params.id)))
			error(404, MISSING);
		redirect(303, '/schadensmeldungen');
	}
};
