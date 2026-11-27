import { error, fail } from '@sveltejs/kit';
import { portalOpenUntil, portalPath } from '#lib/domain/tenant-portal.ts';
import { listDocuments } from '#lib/server/documents.ts';
import { getLease } from '#lib/server/leases.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import {
	acceptMeterReport,
	createPortalLink,
	discardMeterReport,
	listDamageReports,
	listMeterReports,
	portalLink,
	revokePortalLink,
	setDocumentShared
} from '#lib/server/tenant-portal.ts';
import type { Actions, PageServerLoad } from './$types';

// The Mieterportal tab of a lease: the secret link for its tenants, the documents shown there,
// the meter readings they reported, waiting to be taken over, and their Schadensmeldungen.
export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { lease } = await parent();
	const [link, documents, meterReports, damages] = await Promise.all([
		portalLink(locals.db, accountId, lease.id),
		listDocuments(locals.db, accountId, { leaseId: lease.id }),
		listMeterReports(locals.db, accountId, lease.id),
		listDamageReports(locals.db, accountId, lease.id)
	]);
	return {
		link,
		openUntil: portalOpenUntil(lease.endDate),
		documents: documents.map((document) => ({
			id: document.id,
			name: document.name,
			createdAt: document.createdAt,
			shared: document.sharedWithTenant,
			fromTenant: document.uploadedBy === null
		})),
		meterReports,
		damages
	};
};

async function leaseOf(locals: App.Locals, id: string) {
	const lease = await getLease(locals.db, requireAccount(locals), id);
	if (!lease) error(404, 'Diesen Mietvertrag gibt es nicht.');
	return lease;
}

const idOf = (form: FormData, name: string) => {
	const value = form.get(name);
	return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
};

export const actions: Actions = {
	link: async ({ locals, params, url }) => {
		const lease = await leaseOf(locals, params.id);
		const { token } = await createPortalLink(locals.db, auditContext(locals), lease);
		return { linkUrl: `${url.origin}${portalPath(token)}` };
	},
	revoke: async ({ locals, params }) => {
		const lease = await leaseOf(locals, params.id);
		await revokePortalLink(locals.db, auditContext(locals), lease);
		return { revoked: true };
	},
	share: async ({ locals, params, request }) => {
		const form = await request.formData();
		const documentId = idOf(form, 'documentId');
		if (!documentId) error(400, 'Bitte gib an, welches Dokument gemeint ist.');
		const shared = form.get('shared') === '1';
		if (
			!(await setDocumentShared(locals.db, auditContext(locals), params.id, documentId, shared))
		) {
			error(404, 'Dieses Dokument gibt es nicht.');
		}
		return { shared };
	},
	accept: async ({ locals, params, request }) => {
		const reportId = idOf(await request.formData(), 'reportId');
		if (!reportId) error(400, 'Bitte gib an, welcher Zählerstand gemeint ist.');
		const outcome = await acceptMeterReport(locals.db, auditContext(locals), params.id, reportId);
		if (outcome === 'missing') error(404, 'Diesen gemeldeten Zählerstand gibt es nicht mehr.');
		if (outcome === 'duplicate-date') {
			return fail(400, {
				reportId,
				message:
					'Der Zähler hat an diesem Tag schon einen Zählerstand. Prüfe ihn unter Objekt → Zähler und verwirf die Meldung.'
			});
		}
		return { accepted: true };
	},
	discard: async ({ locals, params, request }) => {
		const reportId = idOf(await request.formData(), 'reportId');
		if (!reportId) error(400, 'Bitte gib an, welcher Zählerstand gemeint ist.');
		if (!(await discardMeterReport(locals.db, auditContext(locals), params.id, reportId))) {
			error(404, 'Diesen gemeldeten Zählerstand gibt es nicht mehr.');
		}
		return { discarded: true };
	}
};
