import { error, fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseFinancing } from '#lib/forms/financing.ts';
import { loadReturns, saveFinancing, type ReturnsWindow } from '#lib/server/returns.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Rendite und Cashflow of the last twelve months (default) or of one year, for the portfolio or
// one property: ?zeitraum=2025, ?objekt=<id>. The form below keeps each property's
// Anschaffungskosten and Darlehenssumme.

function windowOf(value: string | null, currentYear: number): ReturnsWindow {
	const year = Number(value);
	return value && Number.isInteger(year) && year >= 1900 && year <= currentYear ? year : 'last12';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const date = today();
	const window = windowOf(url.searchParams.get('zeitraum'), Number(date.slice(0, 4)));
	const propertyId = url.searchParams.get('objekt') || null;
	const page = await loadReturns(locals.db, accountId, { window, propertyId, today: date });
	return { window, propertyId, ...page };
};

export const actions: Actions = {
	financing: async ({ request, locals }) => {
		const result = parseFinancing(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const { propertyId, ...input } = result.data;
		if (!(await saveFinancing(locals.db, auditContext(locals), propertyId, input))) {
			error(404, 'Dieses Objekt gibt es nicht.');
		}
		return { saved: propertyId };
	}
};
