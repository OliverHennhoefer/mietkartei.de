import { fail } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { datevPeriodOf, parseDatevNumbers } from '#lib/forms/bank.ts';
import { datevExport, getDatevNumbers, setDatevNumbers } from '#lib/server/bank/datev.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// DATEV-Export: Beraternummer and Mandantennummer, the period (?von=, ?bis=) and what the
// Buchungsstapel of it holds, with the assigned transactions it leaves out and why. The file
// itself comes from ./export.
export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const period = datevPeriodOf(url.searchParams.get('von'), url.searchParams.get('bis'), today());
	const [numbers, data] = await Promise.all([
		getDatevNumbers(locals.db, accountId),
		period.error ? null : datevExport(locals.db, accountId, period.from, period.to)
	]);
	return {
		numbers,
		period,
		summary: data && {
			bookings: data.bookings.length,
			accountLength: data.accountLength,
			uneven: data.uneven,
			skipped: data.skipped
		}
	};
};

export const actions: Actions = {
	numbers: async ({ request, locals }) => {
		const result = parseDatevNumbers(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		await setDatevNumbers(locals.db, auditContext(locals), result.data);
		return { saved: true };
	}
};
