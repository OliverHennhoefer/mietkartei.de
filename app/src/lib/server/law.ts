import { lawSections, laws } from './law-data';

// The statutes behind the rules the app computes (deadlines, caps, allocation), in their current
// wording from gesetze-im-internet.de (law-data.ts, built by scripts/law.py). They are for
// assistants on the MCP server and the API, so an answer can quote the law instead of a model's
// memory of it; the pages keep their short citations. The app computes and names its basis, it
// gives no legal advice.

export type LawSectionId = (typeof lawSections)[number]['id'];
type LawAbbreviation = (typeof laws)[number]['abbreviation'];

/** A rule's basis: the section to look up and the exact citation, e.g. "§ 556 Abs. 3 BGB". */
export type Citation = { section: LawSectionId; citation: string };

const sectionById = new Map<string, (typeof lawSections)[number]>(
	lawSections.map((section) => [section.id, section])
);

/** `cite('bgb-556', 'Abs. 3 Satz 2')` is "§ 556 Abs. 3 Satz 2 BGB" with its section. */
export function cite(id: LawSectionId, detail?: string): Citation {
	const section = sectionById.get(id)!;
	const parts = [`§ ${section.section}`, detail, section.law].filter(Boolean);
	return { section: id, citation: parts.join(' ') };
}

/** The laws with the sections the app has, without their text. */
export function listLawSections() {
	return laws.map((law) => ({
		...law,
		sections: lawSections
			.filter((section) => section.law === law.abbreviation)
			.map(({ id, section, title }) => ({ id, section, title }))
	}));
}

/** Names the code and older texts use besides the law's own abbreviation. */
const aliases: Record<string, LawAbbreviation> = { heizkv: 'HeizkostenV' };

/**
 * One section by its id ("bgb-556a") or as it is cited ("§ 556a Abs. 3 BGB", "HeizKV § 9a"), with
 * its law's name and version; undefined when the app does not have it.
 */
export function findLawSection(query: string) {
	const normalized = query.trim().toLowerCase();
	let section = sectionById.get(normalized);
	if (!section) {
		const number = /§+\s*(\d+\s*[a-z]?)\b/.exec(normalized)?.[1].replace(/\s/g, '');
		const law = laws.find(
			(law) =>
				new RegExp(`\\b${law.abbreviation.toLowerCase()}\\b`).test(normalized) ||
				Object.entries(aliases).some(
					([alias, target]) =>
						target === law.abbreviation && new RegExp(`\\b${alias}\\b`).test(normalized)
				)
		);
		if (number && law) section = sectionById.get(`${law.abbreviation.toLowerCase()}-${number}`);
	}
	if (!section) return undefined;
	const law = laws.find((law) => law.abbreviation === section.law)!;
	return { ...section, lawName: law.name, version: law.version };
}
