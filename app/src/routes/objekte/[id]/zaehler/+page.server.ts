import { error, fail, redirect } from '@sveltejs/kit';
import type { FieldErrors } from '#lib/forms/fields.ts';
import { formValues, parseMeter, parseReading, parseRemoval } from '#lib/forms/operating-costs.ts';
import type { MeterInput, ReadingInput } from '#lib/server/operating-costs.ts';
import {
	createMeter,
	createReading,
	deleteMeter,
	deleteReading,
	ensureDefaults,
	getMeter,
	listMeters,
	listReadings,
	removeMeter
} from '#lib/server/operating-costs.ts';
import { listUnits } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const missingMeter = 'Diesen Zähler gibt es nicht.';

/** The meter named by the form, only when it belongs to the property of the URL. */
async function meterOf(locals: App.Locals, propertyId: string, meterId: string | null) {
	const meter = meterId ? await getMeter(locals.db, requireAccount(locals), meterId) : undefined;
	if (!meter || meter.propertyId !== propertyId) error(404, missingMeter);
	return meter;
}

function idOf(form: FormData, name: string): string | null {
	const value = form.get(name);
	return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}

/** Keeps the unit filter and the expanded meter in the URL after an action. */
function back(propertyId: string, form: FormData, meterId?: string): string {
	const query = new URLSearchParams();
	const unit = idOf(form, 'filterUnit');
	if (unit) query.set('unit', unit);
	if (meterId) query.set('meter', meterId);
	const suffix = query.toString();
	return `/objekte/${propertyId}/zaehler${suffix ? `?${suffix}` : ''}`;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { property } = await parent();
	await ensureDefaults(locals.db, accountId);
	const [meters, units] = await Promise.all([
		listMeters(locals.db, accountId, property.id),
		listUnits(locals.db, accountId, property.id)
	]);
	const unitFilter = url.searchParams.get('unit');
	const filterUnit = units.find((unit) => unit.id === unitFilter) ?? null;
	const expandedId = url.searchParams.get('meter');
	const expanded = meters.find((meter) => meter.id === expandedId) ?? null;
	const readings = expanded ? await listReadings(locals.db, accountId, expanded.id) : [];
	return {
		meters: filterUnit ? meters.filter((meter) => meter.unitId === filterUnit.id) : meters,
		units,
		filterUnit,
		expanded,
		readings
	};
};

export const actions: Actions = {
	createMeter: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = parseMeter(form);
		if (!result.ok) {
			return fail(400, { form: 'meter' as const, errors: result.errors, values: result.values });
		}
		const created = await createMeter(locals.db, auditContext(locals), params.id, result.data);
		if (!created.ok) {
			if (created.reason === 'unknown-property') error(404, 'Dieses Objekt gibt es nicht.');
			const errors: FieldErrors<MeterInput> = {
				unitId: 'Diese Einheit gehört nicht zu diesem Objekt.'
			};
			return fail(400, { form: 'meter' as const, errors, values: formValues(form) });
		}
		redirect(303, back(params.id, form, created.id));
	},
	createReading: async ({ request, locals, params }) => {
		const form = await request.formData();
		const meter = await meterOf(locals, params.id, idOf(form, 'meterId'));
		const result = parseReading(form);
		if (!result.ok) {
			return fail(400, {
				form: 'reading' as const,
				meterId: meter.id,
				errors: result.errors,
				values: result.values
			});
		}
		const created = await createReading(locals.db, auditContext(locals), meter.id, result.data);
		if (!created.ok) {
			if (created.reason === 'missing') error(404, missingMeter);
			const errors: FieldErrors<ReadingInput> = {
				readAt: 'Für dieses Datum gibt es schon einen Zählerstand.'
			};
			return fail(400, {
				form: 'reading' as const,
				meterId: meter.id,
				errors,
				values: formValues(form)
			});
		}
		redirect(303, back(params.id, form, meter.id));
	},
	removeMeter: async ({ request, locals, params }) => {
		const form = await request.formData();
		const meter = await meterOf(locals, params.id, idOf(form, 'meterId'));
		const result = parseRemoval(form);
		if (!result.ok) {
			return fail(400, {
				form: 'removal' as const,
				meterId: meter.id,
				errors: result.errors,
				values: result.values
			});
		}
		await removeMeter(locals.db, auditContext(locals), meter.id, result.data.removedAt);
		redirect(303, back(params.id, form));
	},
	deleteMeter: async ({ request, locals, params }) => {
		const form = await request.formData();
		const meter = await meterOf(locals, params.id, idOf(form, 'meterId'));
		await deleteMeter(locals.db, auditContext(locals), meter.id);
		redirect(303, back(params.id, form));
	},
	deleteReading: async ({ request, locals, params }) => {
		const form = await request.formData();
		const meter = await meterOf(locals, params.id, idOf(form, 'meterId'));
		const readingId = idOf(form, 'readingId');
		if (!readingId) error(404, 'Diesen Zählerstand gibt es nicht.');
		await deleteReading(locals.db, auditContext(locals), readingId);
		redirect(303, back(params.id, form, meter.id));
	}
};
