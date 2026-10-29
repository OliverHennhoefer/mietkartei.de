import { today, type IsoDate } from '../dates';

// The parties to a lease over time: a tenant on it with the day they joined it after its start
// and the last day of one who left it before its end; null for the start and the end.

export type PartyDays = { joinedOn: IsoDate | null; leftOn: IsoDate | null };

/** Whether the tenant is a party to the lease on the day. */
export function isPartyOn(party: PartyDays, date: IsoDate): boolean {
	return (party.joinedOn ?? '') <= date && (party.leftOn ?? '9999-12-31') >= date;
}

/**
 * The tenants who are parties on the day; every party when none is (the dates leave a gap), so a
 * letter never goes out without a recipient.
 */
export function partiesOn<T>(parties: readonly (PartyDays & { tenant: T })[], date: IsoDate): T[] {
	const on = parties.filter((party) => isPartyOn(party, date));
	return (on.length > 0 ? on : parties).map((party) => party.tenant);
}

/**
 * The tenants who are parties to the lease today: those of the start before it begins, those of
 * the end after it ended. Letters and statements go to them.
 */
export function currentParties<T>(
	lease: { startDate: IsoDate; endDate: IsoDate | null },
	parties: readonly (PartyDays & { tenant: T })[],
	date: IsoDate = today()
): T[] {
	const day =
		date < lease.startDate
			? lease.startDate
			: lease.endDate && date > lease.endDate
				? lease.endDate
				: date;
	return partiesOn(parties, day);
}
