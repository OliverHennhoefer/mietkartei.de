import { normalizePostalCode, normalizeStreet, singleLine } from '../domain/address';
import type { SelfDisclosure } from '../domain/applicants';
import { isIsoDate, today } from '../dates';
import { FormParser, type ParseResult } from './fields';

// Parses the forms of a Neuvermietung: its terms, an applicant as the landlord enters them, and
// the Selbstauskunft as the applicant sends it through the secret link.

export type LettingInput = {
	unitId: string;
	availableFrom: string | null;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	securityDeposit: number;
	requiresWbs: boolean;
	notes: string | null;
};

export function parseLetting(form: FormData): ParseResult<LettingInput> {
	const parser = new FormParser<LettingInput>(form);
	const unitId = parser.id('unitId') ?? '';
	const availableFrom = parser.date('availableFrom', { required: false });
	const baseRent = parser.money('baseRent', { max: 1_000_000_00 }) ?? 0;
	const operatingCostPrepayment =
		parser.money('operatingCostPrepayment', { required: false, max: 100_000_00 }) ?? 0;
	const heatingCostPrepayment =
		parser.money('heatingCostPrepayment', { required: false, max: 100_000_00 }) ?? 0;
	const securityDeposit =
		parser.money('securityDeposit', { required: false, max: 10_000_000_00 }) ?? 0;
	const requiresWbs = parser.flag('requiresWbs');
	const notes = parser.optionalText('notes', 2000);
	return parser.result(() => ({
		unitId,
		availableFrom,
		baseRent,
		operatingCostPrepayment,
		heatingCostPrepayment,
		securityDeposit,
		requiresWbs,
		notes
	}));
}

/** A yes/no select: "ja", "nein" or empty for not answered. */
function yesNo(parser: FormParser<SelfDisclosure>, name: 'insolvency' | 'hasWbs'): boolean | null {
	const value = parser.raw(name);
	if (value === 'ja') return true;
	if (value === 'nein') return false;
	if (value) parser.fail(name, 'Bitte wähle ja oder nein.');
	return null;
}

function birthDate(
	parser: FormParser<SelfDisclosure>,
	name: 'birthDate' | 'coBirthDate'
): string | null {
	const value = parser.date(name, { required: false });
	if (value && value > today()) parser.fail(name, 'Das Datum liegt in der Zukunft.');
	return value;
}

/** The fields of the Selbstauskunft: names required, everything else optional. */
function disclosureFields(parser: FormParser<SelfDisclosure>): () => SelfDisclosure {
	const salutation = parser.optionalText('salutation', 50);
	const firstName = parser.text('firstName', { max: 100 });
	const lastName = parser.text('lastName', { max: 100 });
	const birth = birthDate(parser, 'birthDate');
	const email = parser.raw('email') ? parser.email('email') : null;
	const phone = parser.optionalText('phone', 50);
	const street = normalizeStreet(parser.text('street', { required: false })) || null;
	const postalCode = normalizePostalCode(parser.raw('postalCode')) || null;
	if (postalCode && !/^\d{5}$/.test(postalCode)) {
		parser.fail('postalCode', 'Die Postleitzahl hat fünf Ziffern.');
	}
	const city = singleLine(parser.text('city', { required: false, max: 100 })) || null;
	const adults = parser.number('adults', { required: false, min: 1, max: 20, integer: true });
	const children = parser.number('children', { required: false, min: 0, max: 20, integer: true });
	const occupation = parser.optionalText('occupation', 120);
	const employer = parser.optionalText('employer', 120);
	const netIncome = parser.money('netIncome', { required: false, max: 10_000_000 });
	const pets = parser.optionalText('pets', 200);
	const insolvency = yesNo(parser, 'insolvency');
	const hasWbs = yesNo(parser, 'hasWbs');
	const moveInDate = parser.date('moveInDate', { required: false });
	const coFirstName = parser.optionalText('coFirstName', 100);
	const coLastName = parser.optionalText('coLastName', 100);
	if (Boolean(coFirstName) !== Boolean(coLastName)) {
		parser.fail(
			coFirstName ? 'coLastName' : 'coFirstName',
			'Bitte gib Vor- und Nachnamen der weiteren Person an.'
		);
	}
	const coBirthDate = birthDate(parser, 'coBirthDate');
	const coOccupation = parser.optionalText('coOccupation', 120);
	const coEmployer = parser.optionalText('coEmployer', 120);
	const message = parser.optionalText('message', 2000);
	return () => ({
		salutation,
		firstName,
		lastName,
		birthDate: birth,
		email,
		phone,
		street,
		postalCode,
		city,
		adults,
		children,
		occupation,
		employer,
		netIncome,
		pets,
		insolvency,
		hasWbs,
		moveInDate,
		coFirstName,
		coLastName,
		coBirthDate,
		coOccupation,
		coEmployer,
		message
	});
}

/** What the applicant sends through the link. */
export function parseSelfDisclosure(form: FormData): ParseResult<SelfDisclosure> {
	const parser = new FormParser<SelfDisclosure>(form);
	const fields = disclosureFields(parser);
	return parser.result(fields);
}

export type ApplicantInput = SelfDisclosure & {
	/** Local date and time, YYYY-MM-DDTHH:MM. */
	viewingAt: string | null;
	notes: string | null;
	rating: number | null;
};

/** The applicant as the landlord enters them: the Selbstauskunft plus viewing, note and stars. */
export function parseApplicant(form: FormData): ParseResult<ApplicantInput> {
	const parser = new FormParser<ApplicantInput>(form);
	const fields = disclosureFields(parser as unknown as FormParser<SelfDisclosure>);
	const viewing = parser.raw('viewingAt');
	let viewingAt: string | null = null;
	if (viewing) {
		const valid =
			/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(viewing) &&
			isIsoDate(viewing.slice(0, 10));
		if (valid) viewingAt = viewing;
		else parser.fail('viewingAt', 'Bitte gib Datum und Uhrzeit an.');
	}
	const notes = parser.optionalText('notes', 2000);
	const rating = parser.number('rating', { required: false, min: 1, max: 5, integer: true });
	return parser.result(() => ({ ...fields(), viewingAt, notes, rating }));
}
