import { today } from '#lib/dates.ts';
import { loadAnalysis, type AnalysisPeriod } from '#lib/server/analysis.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// The Auswertung of one year (default: the current one) or of all years, for the portfolio or
// one property: ?jahr=2025 or ?jahr=gesamt, ?objekt=<id>.

function periodOf(value: string | null, currentYear: number): AnalysisPeriod {
	if (value === 'gesamt') return 'all';
	const year = Number(value);
	return Number.isInteger(year) && year >= 1900 && year <= currentYear + 1 ? year : currentYear;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const date = today();
	const period = periodOf(url.searchParams.get('jahr'), Number(date.slice(0, 4)));
	const requested = url.searchParams.get('objekt') || null;
	const analysis = await loadAnalysis(locals.db, accountId, {
		period,
		propertyId: requested,
		today: date
	});
	// An unknown property id shows an empty analysis; the select then offers "alle Objekte".
	return { period, propertyId: requested, today: date, ...analysis };
};
