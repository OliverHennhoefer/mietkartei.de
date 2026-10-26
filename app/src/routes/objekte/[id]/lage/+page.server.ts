import { today } from '#lib/dates.ts';
import { indexSituation } from '#lib/domain/index-rent.ts';
import { rentLevel } from '#lib/domain/rent-level.ts';
import { currentIndexValues } from '#lib/server/consumer-price-index.ts';
import { listLeases } from '#lib/server/leases.ts';
import { municipalitySources } from '#lib/server/municipalities-data.ts';
import { findMunicipality } from '#lib/server/municipalities.ts';
import { listRentChanges } from '#lib/server/rents.ts';
import { requireAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// The "Lage" tab: the property's Gemeinde with its average Zensus rent and Grundsteuer Hebesatz,
// the property's own rent per square metre beside it, and where its Indexmieten stand.

export const load: PageServerLoad = async ({ locals, parent }) => {
	const accountId = requireAccount(locals);
	const { property } = await parent();
	const leases = (await listLeases(locals.db, accountId)).filter(
		(lease) => lease.property.id === property.id && lease.active
	);
	const indexed = leases.filter((lease) => lease.rentModel === 'indexed');
	const values = indexed.length > 0 ? await currentIndexValues(locals.db) : [];
	const day = today();
	const indexLeases = await Promise.all(
		indexed.map(async (lease) => {
			const changes = await listRentChanges(locals.db, accountId, lease.id);
			const situation = indexSituation(lease, changes, values, day);
			return {
				id: lease.id,
				unitName: lease.unit.name,
				tenants: lease.tenants,
				proposal: situation.refusal ? undefined : situation.proposal,
				refusal: situation.refusal
			};
		})
	);
	return {
		municipality: findMunicipality(property),
		rentLevel: rentLevel(leases),
		propertyTaxYear: municipalitySources.propertyTaxYear,
		indexLeases
	};
};
