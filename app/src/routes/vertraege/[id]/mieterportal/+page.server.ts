import { error, fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { listDamageReports } from '#lib/server/damage-reports.ts';
import { getLease } from '#lib/server/leases.ts';
import { sendMail } from '#lib/server/mail.ts';
import { MAIL_LINKS_UNAVAILABLE, mailLinkOrigin } from '#lib/server/mail-links.ts';
import {
	createPortalLink,
	findPortal,
	getPortalLink,
	portalLinkMail,
	revokePortalLink
} from '#lib/server/portal.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mieterportal tab of a lease: the link the tenants open to report damage, and their reports.
// The link is shown once when it is made; a new one replaces it.

const MISSING = 'Diesen Mietvertrag gibt es nicht.';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const [link, reports] = await Promise.all([
		getPortalLink(locals.db, accountId, lease.id),
		listDamageReports(locals.db, accountId, { leaseId: lease.id })
	]);
	return {
		link: link ?? null,
		recipients: lease.tenants.flatMap((tenant) => (tenant.email ? [tenant.email] : [])),
		reports: [...reports.open, ...reports.done]
	};
};

export const actions: Actions = {
	create: async ({ locals, params, url }) => {
		const token = await createPortalLink(locals.db, auditContext(locals), params.id);
		if (!token) error(404, MISSING);
		// Shown to the signed-in landlord only, so the address they reached the app at will do.
		const origin = ORIGIN ? new URL(ORIGIN).origin : url.origin;
		return { created: `${origin}/mieterportal/${token}` };
	},
	send: async ({ locals, params, url }) => {
		const lease = await getLease(locals.db, requireAccount(locals), params.id);
		if (!lease) error(404, MISSING);
		const recipients = lease.tenants.flatMap((tenant) => (tenant.email ? [tenant.email] : []));
		if (recipients.length === 0) {
			return fail(400, {
				message: 'Keiner der Mieter dieses Vertrags hat eine E-Mail-Adresse hinterlegt.'
			});
		}
		// Checked first, so no link replaces the old one that could not be sent.
		const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		if (!origin) return fail(503, { message: MAIL_LINKS_UNAVAILABLE });
		const token = await createPortalLink(locals.db, auditContext(locals), lease.id);
		if (!token) error(404, MISSING);
		const portal = await findPortal(locals.db, token);
		if (!portal) error(404, MISSING);
		const link = `${origin}/mieterportal/${token}`;
		try {
			for (const to of recipients) {
				await sendMail(locals.db, portalLinkMail(to, portal, link));
			}
		} catch (cause) {
			console.error('[mail] Portal link was not sent:', cause);
			return fail(502, {
				message:
					'Die E-Mail konnte nicht verschickt werden, und der bisherige Link gilt nicht mehr. Versuche es später noch einmal oder erzeuge einen Link zum Weitergeben.'
			});
		}
		return { sentTo: recipients };
	},
	revoke: async ({ locals, params }) => {
		await revokePortalLink(locals.db, auditContext(locals), params.id);
		return { revoked: true };
	}
};
