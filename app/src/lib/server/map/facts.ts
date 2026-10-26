import { rentLevel } from '#lib/domain/rent-level.ts';
import type { MapFacts } from '#lib/map/frame.ts';
import type { Database } from '../db/index.ts';
import type { GermanState } from '../../working-days.ts';
import { listBalances } from '../ledger.ts';
import { listLeases } from '../leases.ts';
import { findMunicipality } from '../municipalities.ts';

// What the interactive street map tells about each property when its dot is clicked: the
// Rückstand of its leases today, its rent per square metre and the Zensus average of its Gemeinde
// beside it. listBalances syncs the rent charges first, as on the Mietkonto page.

type Located = { id: string; postalCode: string; city: string; state: GermanState | null };

export async function propertyMapFacts(
	db: Database,
	accountId: string,
	properties: readonly Located[]
): Promise<Record<string, MapFacts>> {
	const [leases, balances] = await Promise.all([
		listLeases(db, accountId),
		listBalances(db, accountId)
	]);
	const facts: Record<string, MapFacts> = {};
	for (const property of properties) {
		const own = leases.filter((lease) => lease.property.id === property.id);
		const ids = new Set(own.map((lease) => lease.id));
		const municipality = findMunicipality(property);
		facts[property.id] = {
			overdue: balances
				.filter((balance) => ids.has(balance.leaseId))
				.reduce((sum, balance) => sum + balance.overdue, 0),
			rentPerSquareMetre: rentLevel(own.filter((lease) => lease.active))?.perSquareMetre ?? null,
			municipality: municipality && {
				name: municipality.name,
				rentPerSquareMetre: municipality.rentPerSquareMetre
			}
		};
	}
	return facts;
}
