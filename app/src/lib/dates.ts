// Dates are ISO strings (YYYY-MM-DD). All arithmetic is done in UTC so the result never depends
// on the server's time zone.

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: IsoDate): [number, number, number] {
	const match = ISO_DATE.exec(date);
	if (!match) throw new Error(`Not an ISO date: ${date}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });

/** The calendar day of a timestamp in Germany, whatever time zone the server runs in. */
export function dayOf(date: Date): IsoDate {
	// sv-SE formats as YYYY-MM-DD.
	return berlinDate.format(date);
}

/** The current date in Germany, whatever time zone the server runs in. */
export function today(): IsoDate {
	return dayOf(new Date());
}

export function formatDate(date: IsoDate): string {
	const [year, month, day] = parts(date);
	return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}
