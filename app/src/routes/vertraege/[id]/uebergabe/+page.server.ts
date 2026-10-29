import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { MAX_KEYS, MAX_ROOMS, protocolDefaults } from '#lib/domain/handover.ts';
import { parseHandover } from '#lib/forms/handover.ts';
import type { HandoverKind } from '#lib/server/db/schema.ts';
import {
	deleteHandover,
	handoverMeters,
	listHandovers,
	saveHandover
} from '#lib/server/handovers.ts';
import { meterLabel } from '#lib/server/operating-costs/meters.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The "Übergabe" tab: the Übergabeprotokolle for moving in and out. ?protokoll=einzug or
// ?protokoll=auszug opens the form of one, prefilled from what is stored, else for the move-out
// from the move-in. The lease comes from the layout.

const kinds: Record<string, HandoverKind> = { einzug: 'move_in', auszug: 'move_out' };

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const protocols = await listHandovers(locals.db, accountId, lease.id);
	const editing = kinds[url.searchParams.get('protokoll') ?? ''] ?? null;
	const day = today();
	// The form proposes the lease's start or end, or today while that is still ahead.
	const proposed = editing === 'move_out' ? lease.endDate : lease.startDate;
	const date =
		(editing && protocols[editing]?.date) ?? (proposed && proposed <= day ? proposed : day);
	const unitIds = [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)];
	// All meters of the units: the page shows those in use on the date as it is typed.
	const meters = editing ? await handoverMeters(locals.db, accountId, unitIds) : [];
	return {
		protocols,
		editing,
		form: editing
			? {
					date,
					...protocolDefaults(protocols[editing], protocols.move_in, lease.unit.rooms),
					attendees: protocols[editing]?.attendees ?? '',
					notes: protocols[editing]?.notes ?? '',
					readings: Object.fromEntries(
						(protocols[editing]?.readings ?? []).map((reading) => [reading.meterId, reading.value])
					)
				}
			: null,
		meters: meters.map((meter) => ({
			id: meter.id,
			label: meterLabel(meter),
			unit: meter.unit,
			installedAt: meter.installedAt,
			removedAt: meter.removedAt
		})),
		maxRooms: MAX_ROOMS,
		maxKeys: MAX_KEYS,
		today: day
	};
};

function kindOf(form: FormData): HandoverKind | undefined {
	return kinds[String(form.get('art') ?? '')];
}

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();
		const kind = kindOf(form);
		if (!kind) return fail(400, { message: 'Unbekanntes Protokoll.' });
		const meterIds = [...form.keys()]
			.filter((name) => name.startsWith('reading-'))
			.map((name) => name.slice('reading-'.length));
		const result = parseHandover(form, meterIds);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const saved = await saveHandover(locals.db, auditContext(locals), params.id, kind, result.data);
		if (!saved) error(404, 'Diesen Mietvertrag gibt es nicht.');
		if (!saved.ok) {
			// The form keeps what was typed.
			const values = Object.fromEntries(
				[...form.entries()].filter(
					(entry): entry is [string, string] => typeof entry[1] === 'string'
				)
			);
			return fail(400, { message: saved.message, values });
		}
		redirect(303, `/vertraege/${params.id}/uebergabe`);
	},

	delete: async ({ request, locals, params }) => {
		const kind = kindOf(await request.formData());
		if (!kind || !(await deleteHandover(locals.db, auditContext(locals), params.id, kind))) {
			return fail(404, { message: 'Dieses Protokoll gibt es nicht.' });
		}
		redirect(303, `/vertraege/${params.id}/uebergabe`);
	}
};
