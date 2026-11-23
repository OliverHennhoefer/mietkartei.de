import { error } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { datevPeriodOf } from '#lib/forms/bank.ts';
import { datevExport, datevFile, datevFilename, getDatevNumbers } from '#lib/server/bank/datev.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// The Buchungsstapel of ?von= to ?bis= as EXTF file in Windows-1252, for the Steuerberater.
export const GET: RequestHandler = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	const period = datevPeriodOf(url.searchParams.get('von'), url.searchParams.get('bis'), today());
	if (period.error) error(400, period.error);
	const numbers = await getDatevNumbers(locals.db, accountId);
	if (!numbers.advisorNumber || !numbers.clientNumber) {
		error(400, 'Trage zuerst Beraternummer und Mandantennummer ein.');
	}
	const data = await datevExport(locals.db, accountId, period.from, period.to);
	const file = datevFile(
		{ advisorNumber: numbers.advisorNumber, clientNumber: numbers.clientNumber },
		data,
		period.from,
		period.to
	);
	const filename = datevFilename(period.from, period.to);
	return new Response(file, {
		headers: {
			'Content-Type': 'text/csv; charset=windows-1252',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
