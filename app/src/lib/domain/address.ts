// Addresses and floors as people type them: with a house number suffix („Haberacker 1e“, „12 a“),
// a range („4-6“), commas, tabs, double or non-breaking spaces. Nothing here refuses an address;
// the functions tidy the spacing for letters and compare two spellings of the same street.

/** One line of text: runs of spaces, tabs, line breaks and non-breaking spaces become one space. */
export function singleLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * A street as stored: one space between words, none before a comma and one after it, so
 * „Haberacker  1e“ and „Am Markt ,3“ read „Haberacker 1e“ and „Am Markt, 3“. The house number
 * and its suffix stay as typed.
 */
export function normalizeStreet(value: string): string {
	return singleLine(value)
		.replace(/\s*,\s*/g, ', ')
		.replace(/,\s*$/, '')
		.trim();
}

/** A postal code without spaces, so „10 115“ is accepted as 10115. */
export function normalizePostalCode(value: string): string {
	return value.replace(/\s+/g, '');
}

/**
 * A street compared with another spelling of it: case, spaces, commas and hyphens between letters
 * do not count, and „Str.“, „Str“ and „Strasse“ read as „Straße“. So „Karl-Liebknecht-Str. 18“
 * matches „Karl Liebknecht Straße 18“ and „Haberacker 1 E“ matches „Haberacker 1e“, while a
 * hyphen in a house number range („4-6“) still counts.
 */
export function streetKey(value: string): string {
	return singleLine(value)
		.toLowerCase()
		.replace(/strasse/g, 'straße')
		.replace(/str\.?(?=[\s,\d-]|$)/g, 'straße')
		.replace(/(?<=\p{L})-(?=\p{L})/gu, '')
		.replace(/[\s,]/g, '');
}

const ordinals: Record<string, number> = {
	erst: 1,
	zweit: 2,
	dritt: 3,
	viert: 4,
	fünft: 5,
	fuenft: 5,
	sechst: 6,
	siebt: 7,
	siebent: 7,
	acht: 8,
	neunt: 9,
	zehnt: 10
};

const upperFloor = '(?:og|o\\.g\\.|obergeschoss|obergeschoß|stock|stockwerk|etage)';

/** Ground, top and lower floors by their short names; anything else keeps its wording. */
const namedFloors: [string, string][] = [
	['eg|e\\.g\\.|erdgeschoss|erdgeschoß|parterre', 'EG'],
	['dg|d\\.g\\.|dachgeschoss|dachgeschoß', 'DG'],
	['ug|u\\.g\\.|untergeschoss|untergeschoß', 'UG'],
	['kg|k\\.g\\.|kellergeschoss|kellergeschoß', 'KG']
];

/** The floor's short name and what followed it, e.g. „links“ or „, Hinterhaus“. */
function withRest(floor: string, rest: string): string {
	const tail = rest.trim();
	if (!tail) return floor;
	return tail.startsWith(',') ? `${floor}${tail}` : `${floor} ${tail}`;
}

/**
 * The floor of a unit in one spelling: „4 og“, „4.OG“, „4. Stock“, „viertes OG“ and „4. Etage“
 * become „4. OG“, „eg“ and „Erdgeschoss“ become „EG“, likewise DG, UG and KG. What follows the
 * floor stays („3.og links“ is „3. OG links“); a text that is not recognised is kept as typed,
 * only its spacing tidied.
 */
export function normalizeFloor(value: string): string {
	const text = singleLine(value);
	const lower = text.toLowerCase();
	// The rest is cut from the typed text, so „links“ keeps its case; lower-casing keeps lengths
	// for German text (ß stays ß).
	const restOf = (match: RegExpExecArray) => text.slice(match[0].length - match.at(-1)!.length);
	const end = '(?=$|[\\s,])(.*)$';

	const numbered = new RegExp(`^(\\d{1,2})\\s*\\.?\\s*${upperFloor}${end}`).exec(lower);
	if (numbered) {
		const floor = Number(numbered[1]);
		return withRest(floor === 0 ? 'EG' : `${floor}. OG`, restOf(numbered));
	}
	const ordinal = new RegExp(
		`^(${Object.keys(ordinals).join('|')})(?:e|es|er|en)?\\s+${upperFloor}${end}`
	).exec(lower);
	if (ordinal) return withRest(`${ordinals[ordinal[1]]}. OG`, restOf(ordinal));

	for (const [pattern, name] of namedFloors) {
		const named = new RegExp(`^(?:${pattern})${end}`).exec(lower);
		if (named) return withRest(name, restOf(named));
	}
	return text;
}
