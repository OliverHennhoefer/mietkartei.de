import { error, fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { parseDamageReport } from '#lib/forms/damage-reports.ts';
import {
	createDamageReport,
	damageReportMail,
	listPortalReports
} from '#lib/server/damage-reports.ts';
import { listAccountUsers } from '#lib/server/invitations.ts';
import { sendMailInBackground } from '#lib/server/mail.ts';
import { mailLinkOrigin } from '#lib/server/mail-links.ts';
import { findPortal } from '#lib/server/portal.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mieterportal: tenants open it through the link of their lease, without signing in. They
// see the unit, report damage and follow their own reports; nothing else of the account.

const NOT_FOUND =
	'Diesen Link gibt es nicht (mehr). Bitte fragen Sie Ihren Vermieter nach einem neuen.';

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	const portal = await findPortal(locals.db, params.token);
	if (!portal) error(404, NOT_FOUND);
	// The page is personal: no browser or proxy keeps it, no search engine lists it.
	setHeaders({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
	return {
		unitName: portal.unitName,
		propertyName: portal.propertyName,
		address: portal.address,
		landlord: portal.landlord,
		reports: await listPortalReports(locals.db, portal)
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request, url }) => {
		const portal = await findPortal(locals.db, params.token);
		if (!portal) error(404, NOT_FOUND);
		const result = parseDamageReport(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const { photos, ...input } = result.data;
		const created = await createDamageReport(
			locals.db,
			portal,
			input,
			await Promise.all(
				photos.map(async (photo) => ({
					name: photo.name,
					mimeType: photo.type,
					bytes: new Uint8Array(await photo.arrayBuffer())
				}))
			)
		);
		if (!created.ok) {
			return fail(429, {
				message:
					'Über diesen Link sind heute schon viele Meldungen eingegangen. Bitte versuchen Sie es morgen wieder oder wenden Sie sich direkt an Ihren Vermieter.'
			});
		}

		const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		const link = origin && `${origin}/schadensmeldungen/${created.id}`;
		const label = `${portal.unitName} · ${portal.propertyName}`;
		for (const user of await listAccountUsers(locals.db, portal.accountId)) {
			await sendMailInBackground(locals.db, damageReportMail(user.email, input, label, link));
		}
		return { sent: input.title, photos: created.photos, photosSent: photos.length };
	}
};
