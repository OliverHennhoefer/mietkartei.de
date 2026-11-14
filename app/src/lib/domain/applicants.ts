import { addMonths, formatDate, type IsoDate } from '../dates';
import { formatCents } from '../money';
import type { ApplicantStatus } from '../server/db/schema';

// Neuvermietung: the rules for Mietinteressenten that both the pages and the server share. The
// questions and proofs follow the Orientierungshilfe of the Datenschutzkonferenz on Selbstauskünfte
// bei Mietinteressent:innen (version 2.0, January 2026):
// - Before a viewing only name, address and contact; the Selbstauskunft comes once someone wants
//   to rent: persons moving in, net income, occupation and employer, pets that need consent, an
//   open Verbraucherinsolvenz, a WBS for geförderten Wohnraum.
// - Never asked: nationality, marital status or plans, length of employment, former landlords, a
//   Mietschuldenfreiheitsbescheinigung (BGH VIII ZR 238/08), criminal records, memberships.
// - Proofs are shown, not copied: the app records the day it saw them. An ID is shown only.
// - Data of applicants who get no lease is deleted once it is no longer needed, at the latest six
//   months after the decision (§ 21 AGG). The app deletes it after RETENTION_MONTHS.

/** Months after an Absage (or the close of the Neuvermietung) until the data is deleted. */
export const RETENTION_MONTHS = 3;

/** Days the secret link to the Selbstauskunft is valid. */
export const DISCLOSURE_LINK_DAYS = 14;

/** The statuses before a decision, in the order of the process. */
export const openStatuses = ['new', 'viewing', 'applied', 'shortlisted'] as const;

/** Rejected or withdrawn: deleted after the retention period. */
export const closedStatuses = ['rejected', 'withdrawn'] as const;

export function isOpenStatus(status: ApplicantStatus): boolean {
	return (openStatuses as readonly string[]).includes(status);
}

export function isClosedStatus(status: ApplicantStatus): boolean {
	return (closedStatuses as readonly string[]).includes(status);
}

/** The order of the comparison: the most promising first, the decided last. */
const statusRank: Record<ApplicantStatus, number> = {
	accepted: 0,
	shortlisted: 1,
	applied: 2,
	viewing: 3,
	new: 4,
	withdrawn: 5,
	rejected: 6
};

export function byStatus(a: ApplicantStatus, b: ApplicantStatus): number {
	return statusRank[a] - statusRank[b];
}

/** The day the data of an applicant decided on that day, or of a letting closed then, is deleted. */
export function deletionDate(decidedOn: IsoDate): IsoDate {
	return addMonths(decidedOn, RETENTION_MONTHS);
}

export type LettingTerms = {
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
};

/** Kaltmiete plus both prepayments, in cents. */
export function warmRent(terms: LettingTerms): number {
	return terms.baseRent + terms.operatingCostPrepayment + terms.heatingCostPrepayment;
}

/**
 * Mietbelastung: the share of the household's net income the warm rent takes, or null without
 * an income or a rent.
 */
export function rentBurden(terms: LettingTerms, netIncome: number | null): number | null {
	const rent = warmRent(terms);
	if (!netIncome || netIncome <= 0 || rent <= 0) return null;
	return rent / netIncome;
}

/**
 * How the burden reads: up to 30 % is the common rule of thumb, up to 40 % is tight, above that
 * the rent is likely too much.
 */
export function burdenTone(burden: number): 'success' | 'warning' | 'danger' {
	if (burden <= 0.3) return 'success';
	if (burden <= 0.4) return 'warning';
	return 'danger';
}

export type ProofKey = 'idCheckedOn' | 'creditProofOn' | 'incomeProofOn' | 'wbsProofOn';

export type Proof = { key: ProofKey; label: string; hint: string };

const proofs: Proof[] = [
	{
		key: 'idCheckedOn',
		label: 'Ausweis vorgezeigt',
		hint: 'Nur ansehen, um Name und Anschrift zu prüfen; eine Kopie ist nicht erlaubt.'
	},
	{
		key: 'creditProofOn',
		label: 'Bonitätsnachweis',
		hint: 'Holt der Bewerber selbst, etwa den SCHUFA-BonitätsCheck für Vermieter; nicht die vollständige Datenkopie nach Art. 15 DSGVO.'
	},
	{
		key: 'incomeProofOn',
		label: 'Einkommensnachweis',
		hint: 'Erst kurz vor dem Vertrag, etwa die letzten Gehaltsabrechnungen; nicht nötige Angaben darf der Bewerber schwärzen.'
	},
	{
		key: 'wbsProofOn',
		label: 'Wohnberechtigungsschein',
		hint: 'Nur bei gefördertem Wohnraum.'
	}
];

/** The proofs a letting asks for: the WBS only for geförderten Wohnraum. */
export function proofsFor(letting: { requiresWbs: boolean }): Proof[] {
	return proofs.filter((proof) => proof.key !== 'wbsProofOn' || letting.requiresWbs);
}

/** How many of the letting's proofs the applicant has shown. */
export function proofCount(
	applicant: Record<ProofKey, string | null>,
	letting: { requiresWbs: boolean }
): { shown: number; total: number } {
	const asked = proofsFor(letting);
	return {
		shown: asked.filter((proof) => applicant[proof.key] !== null).length,
		total: asked.length
	};
}

/** Adults and children moving in, or null when neither was given. */
export function householdSize(applicant: {
	adults: number | null;
	children: number | null;
}): number | null {
	if (applicant.adults === null && applicant.children === null) return null;
	return (applicant.adults ?? 0) + (applicant.children ?? 0);
}

export type Landlord = {
	name: string;
	street: string | null;
	postalCode: string | null;
	city: string | null;
};

/** The landlord on one line, for the notice: "Erika Muster, Lindenstraße 4, 10969 Berlin". */
function landlordLine(landlord: Landlord): string {
	const place = [landlord.postalCode, landlord.city].filter(Boolean).join(' ');
	return [landlord.name, landlord.street, place].filter(Boolean).join(', ');
}

/**
 * Datenschutzhinweis nach Art. 13 DSGVO for the applicant, on the PDF and the online form. The
 * landlord is the controller; the software and its hosting are processors.
 */
export function privacyNotice(landlord: Landlord): string[] {
	return [
		`Verantwortlich für Ihre Angaben ist ${landlordLine(landlord) || 'der Vermieter'}.`,
		'Ihre Angaben dienen nur der Entscheidung, ob ein Mietvertrag mit Ihnen geschlossen wird (Art. 6 Abs. 1 lit. b DSGVO). Pflicht sind nur Name und Kontaktdaten; ohne die übrigen Angaben kann Ihre Bewerbung aber womöglich nicht berücksichtigt werden.',
		`Der Vermieter speichert die Angaben in der Mietverwaltung mietkartei. Der Betreiber der Software und dessen Hosting-Anbieter verarbeiten sie nur im Auftrag des Vermieters (Art. 28 DSGVO). Kommt kein Mietvertrag zustande, werden Ihre Angaben ${RETENTION_MONTHS} Monate nach der Absage gelöscht; diese Zeit dient nur der Abwehr von Ansprüchen nach dem Allgemeinen Gleichbehandlungsgesetz. Kommt ein Vertrag zustande, übernimmt der Vermieter Name, Geburtsdatum und Kontaktdaten in seine Mieterdaten; die übrigen Angaben werden ${RETENTION_MONTHS} Monate nach Abschluss der Vermietung gelöscht.`,
		'Sie haben das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung sowie auf Widerspruch (Art. 15 bis 21 DSGVO). Wenden Sie sich dazu an den Vermieter. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.'
	];
}

/** The fields of the Selbstauskunft as the applicant fills them in. */
export type SelfDisclosure = {
	salutation: string | null;
	firstName: string;
	lastName: string;
	birthDate: string | null;
	email: string | null;
	phone: string | null;
	street: string | null;
	postalCode: string | null;
	city: string | null;
	adults: number | null;
	children: number | null;
	occupation: string | null;
	employer: string | null;
	netIncome: number | null;
	pets: string | null;
	insolvency: boolean | null;
	hasWbs: boolean | null;
	moveInDate: string | null;
	coFirstName: string | null;
	coLastName: string | null;
	coBirthDate: string | null;
	coOccupation: string | null;
	coEmployer: string | null;
	message: string | null;
};

const yesNo = (value: boolean | null) => (value === null ? '' : value ? 'ja' : 'nein');
const dateOf = (value: string | null) => (value ? formatDate(value) : '');
const count = (value: number | null) => (value === null ? '' : String(value));

/**
 * The questions with their answers, as rows of label and value for the PDF. A blank form passes
 * null and gets empty values to fill in by hand.
 */
export function disclosureRows(
	answers: SelfDisclosure | null,
	letting: { requiresWbs: boolean }
): { title: string; rows: [string, string][] }[] {
	const a = answers;
	const name = a ? [a.salutation, a.firstName, a.lastName].filter(Boolean).join(' ') : '';
	const address = a
		? [a.street, [a.postalCode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
		: '';
	const coName = a ? [a.coFirstName, a.coLastName].filter(Boolean).join(' ') : '';
	return [
		{
			title: 'Mietinteressent',
			rows: [
				['Name', name],
				['Geburtsdatum', dateOf(a?.birthDate ?? null)],
				['Derzeitige Anschrift', address],
				['Telefon', a?.phone ?? ''],
				['E-Mail', a?.email ?? '']
			]
		},
		{
			title: 'Weitere Person, die den Mietvertrag unterschreibt (falls vorhanden)',
			rows: [
				['Name', coName],
				['Geburtsdatum', dateOf(a?.coBirthDate ?? null)],
				['Beruf', a?.coOccupation ?? ''],
				['Arbeitgeber', a?.coEmployer ?? '']
			]
		},
		{
			title: 'Haushalt und Einkommen',
			rows: [
				['Einziehende Erwachsene', count(a?.adults ?? null)],
				['Einziehende Kinder', count(a?.children ?? null)],
				['Beruf', a?.occupation ?? ''],
				['Arbeitgeber', a?.employer ?? ''],
				[
					'Monatliches Nettoeinkommen des Haushalts',
					a?.netIncome != null ? formatCents(a.netIncome) : ''
				],
				['Haustiere, die eine Erlaubnis brauchen (keine Kleintiere)', a?.pets ?? ''],
				['Läuft ein Verbraucherinsolvenzverfahren?', yesNo(a?.insolvency ?? null)],
				...(letting.requiresWbs
					? [['Wohnberechtigungsschein vorhanden?', yesNo(a?.hasWbs ?? null)] as [string, string]]
					: []),
				['Gewünschter Einzug', dateOf(a?.moveInDate ?? null)]
			]
		}
	];
}
