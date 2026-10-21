import { error, fail, redirect } from '@sveltejs/kit';
import { formatDate } from '#lib/dates.ts';
import { personName, pluralize } from '#lib/format.ts';
import { listLeases } from '#lib/server/leases.ts';
import { deleteProperty, updateProperty } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { parseProperty } from '#lib/validation.ts';
import type { Actions, PageServerLoad } from './$types';

// The property comes from +layout.server.ts (data.property), which answers 404.
export const load: PageServerLoad = async ({ locals }) => {
	requireAccount(locals);
	return {};
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const result = parseProperty(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const updated = await updateProperty(locals.db, auditContext(locals), params.id, result.data);
		if (!updated) error(404, 'Dieses Objekt gibt es nicht.');
		redirect(303, `/objekte/${params.id}`);
	},
	delete: async ({ locals, params }) => {
		const outcome = await deleteProperty(locals.db, auditContext(locals), params.id);
		if (outcome === 'missing') error(404, 'Dieses Objekt gibt es nicht.');
		if (outcome === 'in-use') {
			// Every lease on a unit blocks, ended ones too, so the refusal names and links them.
			const leases = (await listLeases(locals.db, requireAccount(locals))).filter(
				(lease) =>
					lease.property.id === params.id ||
					lease.extraUnits.some((unit) => unit.propertyId === params.id)
			);
			return fail(400, {
				deleteError: `Das Objekt kann nicht gelöscht werden, solange Mietverträge auf seinen Einheiten liegen, auch beendete: Sie bleiben mit ihrer Geschichte erhalten. ${leases.length === 1 ? 'Es liegt' : 'Es liegen'} ${pluralize(leases.length, 'Mietvertrag', 'Mietverträge')} darauf; einen Mietvertrag ohne Kautionsbewegungen kannst du auf seiner Seite löschen.`,
				blockingLeases: leases.map((lease) => ({
					id: lease.id,
					label: `${lease.unit.name}: ${
						lease.tenants.length > 0 ? lease.tenants.map(personName).join(', ') : 'ohne Mieter'
					}, seit ${formatDate(lease.startDate)}${lease.endDate ? ` bis ${formatDate(lease.endDate)}` : ''}`
				}))
			});
		}
		redirect(303, '/objekte');
	}
};
