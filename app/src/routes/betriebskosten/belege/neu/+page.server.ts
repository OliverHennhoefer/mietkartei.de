import { fail, redirect } from '@sveltejs/kit';
import { isIsoDate } from '#lib/dates.ts';
import { calendarYear } from '#lib/domain/operating-costs.ts';
import {
	createCostItem,
	ensureDefaults,
	listCategories,
	listCircles,
	listKeys
} from '#lib/server/operating-costs.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { costItemFailure, itemPage, parseCostItemForm, storeReceipt } from '../save.server';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const [properties, categories, keys, circles] = await Promise.all([
		listProperties(locals.db, accountId),
		listCategories(locals.db, accountId),
		listKeys(locals.db, accountId),
		listCircles(locals.db, accountId)
	]);
	// ?property= and ?year= come from the list, ?from=/?to= from "Speichern und nächsten Beleg".
	const propertyParam = url.searchParams.get('property');
	const propertyId = properties.find((property) => property.id === propertyParam)?.id;
	const year = url.searchParams.get('year');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const period =
		from && to && isIsoDate(from) && isIsoDate(to)
			? { periodStart: from, periodEnd: to }
			: year && /^\d{4}$/.test(year)
				? calendarYear(Number(year))
				: undefined;
	return { properties, categories, keys, circles, prefill: { propertyId, ...period } };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const accountId = requireAccount(locals);
		const form = await request.formData();
		const parsed = await parseCostItemForm(locals.db, accountId, form);
		if (!parsed.ok) return fail(400, parsed.failure);
		const { input, receipt, values } = parsed.parsed;
		const context = auditContext(locals);
		const created = await createCostItem(locals.db, context, input);
		if (!created.ok) return fail(400, costItemFailure(created.reason, values));
		const receiptError = receipt
			? await storeReceipt(locals.db, context, created.id, input.propertyId, receipt)
			: undefined;
		if (receiptError) redirect(303, itemPage(created.id, receiptError));
		if (form.get('next') === '1') {
			const query = new URLSearchParams({
				property: input.propertyId,
				from: input.periodStart,
				to: input.periodEnd
			});
			redirect(303, `/betriebskosten/belege/neu?${query}`);
		}
		redirect(303, itemPage(created.id));
	}
};
