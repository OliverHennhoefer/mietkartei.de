import { today } from '#lib/dates.ts';
import { filterYears, sumByCategory, yearOf } from '#lib/domain/operating-costs.ts';
import { ensureDefaults, listCostItemYears, listCostItems } from '#lib/server/operating-costs.ts';
import { listProperties } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const [properties, yearsWithItems] = await Promise.all([
		listProperties(locals.db, accountId, { archived: true }),
		listCostItemYears(locals.db, accountId)
	]);
	const propertyParam = url.searchParams.get('property');
	const property = properties.find((candidate) => candidate.id === propertyParam) ?? null;
	// "" means every year; no parameter means the current one. A year without items (the year of
	// an item just deleted, a typed URL) is offered too, so the filter shows what was asked for.
	const yearParam = url.searchParams.get('year');
	const year =
		yearParam === null ? yearOf(today()) : /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
	const years = filterYears(
		year === null ? yearsWithItems : [...yearsWithItems, year],
		yearOf(today())
	);

	const items = await listCostItems(locals.db, accountId, {
		propertyId: property?.id,
		year: year ?? undefined
	});
	return {
		properties,
		years,
		property,
		year,
		items,
		totals: sumByCategory(items),
		total: items.reduce((sum, item) => sum + item.amount, 0)
	};
};
