import { fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { portalPrivacyNotice } from '#lib/domain/tenant-portal.ts';
import { documentErrorMessage } from '#lib/forms/documents.ts';
import { parseDamageReport, parseMeterReport } from '#lib/forms/tenant-portal.ts';
import {
	openPortal,
	portalView,
	reportDamage,
	reportMeterReading,
	type PortalRefusal
} from '#lib/server/tenant-portal.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mieterportal behind the secret link of a lease: its tenants see the statements that reached
// them and the documents the landlord shared, and report meter readings and damage, without an
// account. The token in the path is the only credential; an unknown or expired link shows a
// notice instead. Nothing else of the landlord's account is shown.

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	// The page holds the tenants' names and statements, and they are not signed in, so the app's
	// no-store for signed-in pages does not apply on its own.
	setHeaders({ 'cache-control': 'private, no-store' });
	const access = await openPortal(locals.db, params.token);
	if (!access) return { state: 'invalid' as const };
	const view = await portalView(locals.db, access);
	return {
		state: 'open' as const,
		today: today(),
		view,
		notice: portalPrivacyNotice(view.landlord)
	};
};

const refusals: Record<
	Exclude<PortalRefusal, 'too-large' | 'empty' | 'unknown-link' | 'quota'>,
	string
> = {
	'unknown-meter': 'Diesen Zähler gibt es nicht mehr. Bitte laden Sie die Seite neu.',
	'future-date': 'Das Datum liegt in der Zukunft.',
	'before-lease': 'Das Datum liegt vor dem Beginn Ihres Mietvertrags.',
	'too-many':
		'Es liegen schon viele Meldungen vor, die der Vermieter noch nicht bearbeitet hat. Bitte wenden Sie sich direkt an ihn.',
	'not-a-photo': 'Bitte wählen Sie ein Foto (JPEG, PNG, WebP oder HEIC).'
};

/** The field of the meter form a refusal belongs to; the rest concern the photo. */
const meterFields = {
	'unknown-meter': 'meterId',
	'future-date': 'readAt',
	'before-lease': 'readAt',
	'too-many': 'value'
} as const;

function refusalMessage(reason: PortalRefusal): string {
	if (reason === 'quota' || reason === 'unknown-link') {
		return 'Das Foto ließ sich nicht speichern. Bitte senden Sie die Meldung ohne Foto.';
	}
	if (reason === 'too-large' || reason === 'empty') return documentErrorMessage(reason);
	return refusals[reason];
}

export const actions: Actions = {
	meter: async ({ locals, params, request }) => {
		const access = await openPortal(locals.db, params.token);
		if (!access) return fail(400, { invalid: true });
		const result = await parseMeterReport(await request.formData());
		if (!result.ok) {
			return fail(400, { which: 'meter' as const, errors: result.errors, values: result.values });
		}
		const outcome = await reportMeterReading(locals.db, access, result.data);
		if (!outcome.ok) {
			const field = meterFields[outcome.reason as keyof typeof meterFields] ?? 'photo';
			return fail(400, {
				which: 'meter' as const,
				errors: { [field]: refusalMessage(outcome.reason) },
				values: {
					meterId: result.data.meterId,
					readAt: result.data.readAt,
					value: String(result.data.value).replace('.', ','),
					note: result.data.note ?? ''
				}
			});
		}
		return { which: 'meter' as const, sent: true };
	},
	damage: async ({ locals, params, request }) => {
		const access = await openPortal(locals.db, params.token);
		if (!access) return fail(400, { invalid: true });
		const result = await parseDamageReport(await request.formData());
		if (!result.ok) {
			return fail(400, { which: 'damage' as const, errors: result.errors, values: result.values });
		}
		const outcome = await reportDamage(locals.db, access, result.data);
		if (!outcome.ok) {
			return fail(400, {
				which: 'damage' as const,
				errors: {
					[outcome.reason === 'too-many' ? 'title' : 'photos']: refusalMessage(outcome.reason)
				},
				values: {
					title: result.data.title,
					description: result.data.description,
					reporter: result.data.reporter,
					phone: result.data.phone ?? ''
				}
			});
		}
		return {
			which: 'damage' as const,
			sent: true,
			photosMissing: result.data.photos.length - outcome.photosStored
		};
	}
};
