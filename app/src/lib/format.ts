// Formatting helpers for things that are neither money nor dates.

const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** `72.5` → `72,5`. */
export function formatNumber(value: number, fractionDigits = 2): string {
	if (fractionDigits === 2) return number.format(value);
	return new Intl.NumberFormat('de-DE', { maximumFractionDigits: fractionDigits }).format(value);
}

/** `72.5` → `72,5 m²`. */
export function formatArea(squareMetres: number): string {
	return `${number.format(squareMetres)}\u00a0m²`;
}

/** `pluralize(3, 'Einheit', 'Einheiten')` → `3 Einheiten`. */
export function pluralize(count: number, singular: string, plural: string): string {
	return `${number.format(count)}\u00a0${count === 1 ? singular : plural}`;
}

/** Full name of a tenant for lists and letters. */
export function personName(person: { firstName: string; lastName: string }): string {
	return `${person.firstName} ${person.lastName}`.trim();
}
