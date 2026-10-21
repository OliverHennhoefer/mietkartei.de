import {
	ensureDefaults,
	listCategories,
	listCircles,
	listKeys
} from '#lib/server/operating-costs.ts';
import { listProperties } from '#lib/server/properties.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const [categories, keys, properties, circles] = await Promise.all([
		listCategories(locals.db, accountId),
		listKeys(locals.db, accountId),
		listProperties(locals.db, accountId),
		listCircles(locals.db, accountId)
	]);
	return {
		categoryCount: categories.length,
		allocableCount: categories.filter((category) => category.allocable).length,
		keyCount: keys.length,
		properties: properties.map((property) => ({
			id: property.id,
			name: property.name,
			circleCount: circles.filter((circle) => circle.propertyId === property.id).length
		}))
	};
};
