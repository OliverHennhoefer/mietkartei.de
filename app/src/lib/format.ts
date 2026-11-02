// Formatting helpers for things that are neither money nor dates.

const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** `72.5` → `72,5`; at most `fractionDigits` decimals (2 by default). */
export function formatNumber(value: number, fractionDigits = 2): string {
	if (fractionDigits === 2) return number.format(value);
	return new Intl.NumberFormat('de-DE', { maximumFractionDigits: fractionDigits }).format(value);
}

/**
 * A decimal as typed into a form field, read like the form parser does: `5.025,5` and `5025.5`
 * are both 5025.5. Null for an empty or malformed entry.
 */
export function parseDecimal(input: string): number | null {
	const value = input.trim();
	if (!value) return null;
	const parsed = Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value);
	return Number.isFinite(parsed) ? parsed : null;
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

/** Words that begin a last name: „Anna von Berg“, „Ludwig van Beethoven“. */
const nameParticles = new Set([
	'von',
	'vom',
	'van',
	'zu',
	'zum',
	'zur',
	'de',
	'der',
	'den',
	'del',
	'della',
	'di',
	'da',
	'du',
	'dos',
	'le',
	'la',
	'ten',
	'ter'
]);

/**
 * A name typed in one field, split into first and last name: „Max Mustermann“, „Anna Maria von
 * Berg“ (first „Anna Maria“, last „von Berg“) or „Mustermann, Max“. Null for a single word, which
 * leaves the last name unclear.
 */
export function splitPersonName(text: string): { firstName: string; lastName: string } | null {
	const name = text.replace(/\s+/g, ' ').trim();
	const comma = name.indexOf(',');
	if (comma >= 0) {
		const lastName = name.slice(0, comma).trim();
		const firstName = name
			.slice(comma + 1)
			.replace(/,/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		return lastName && firstName ? { firstName, lastName } : null;
	}
	const words = name.split(' ');
	if (words.length < 2) return null;
	let index = words.length - 1;
	while (index > 1 && nameParticles.has(words[index - 1].toLowerCase())) index--;
	return { firstName: words.slice(0, index).join(' '), lastName: words.slice(index).join(' ') };
}
