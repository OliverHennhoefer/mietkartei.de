import { FormParser, type FieldErrors, type ParseResult } from './forms/fields';
import { buildingUseLabels, stateLabels } from './labels';
import type { BuildingUse } from './server/db/schema';
import { unitKinds, type UnitKind } from './units';
import type { GermanState } from './working-days';

export type { FieldErrors, ParseResult };

export type PropertyInput = {
	name: string;
	street: string;
	postalCode: string;
	city: string;
	buildingUse: BuildingUse;
	/** Bundesland for the public holidays; null when not given. */
	state: GermanState | null;
	/** Persons a vacant unit counts with in the persons key, 0–10. */
	vacancyPersons: number;
	notes: string | null;
};

export type UnitInput = {
	name: string;
	kind: UnitKind;
	floorArea: number | null;
	floor: string | null;
	rooms: number | null;
	notes: string | null;
};

// validation.ts is also loaded in the browser, so the enum comes from the labels, not the schema.
const buildingUses = Object.keys(buildingUseLabels) as BuildingUse[];
const states = Object.keys(stateLabels) as GermanState[];

function text(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

/** The property form. A missing building use or vacancy count takes the defaults of a new property. */
export function parseProperty(form: FormData): ParseResult<PropertyInput> {
	const parser = new FormParser<PropertyInput>(form);

	const name = parser.raw('name');
	if (!name) parser.fail('name', 'Bitte gib eine Bezeichnung an.');
	else if (name.length > 100) parser.fail('name', 'Die Bezeichnung ist zu lang.');
	const street = parser.raw('street');
	if (!street) parser.fail('street', 'Bitte gib Straße und Hausnummer an.');
	else if (street.length > 200) parser.fail('street', 'Höchstens 200 Zeichen.');
	const postalCode = parser.raw('postalCode');
	if (!/^\d{5}$/.test(postalCode)) {
		parser.fail('postalCode', 'Die Postleitzahl hat fünf Ziffern.');
	}
	const city = parser.raw('city');
	if (!city) parser.fail('city', 'Bitte gib den Ort an.');
	else if (city.length > 100) parser.fail('city', 'Höchstens 100 Zeichen.');

	const buildingUse = parser.oneOf('buildingUse', buildingUses, { required: false });
	const state = parser.oneOf('state', states, { required: false });
	const vacancyPersons = parser.number('vacancyPersons', {
		required: false,
		integer: true,
		min: 0,
		max: 10
	});
	const notes = parser.optionalText('notes', 2000);

	return parser.result(() => ({
		name,
		street,
		postalCode,
		city,
		buildingUse: buildingUse ?? 'residential',
		state,
		vacancyPersons: vacancyPersons ?? 1,
		notes
	}));
}

/** A positive decimal (German comma accepted), null when empty; `message` replaces the generic error. */
function positiveNumber<T>(
	parser: FormParser<T>,
	name: keyof T & string,
	max: number,
	message: string
): number | null {
	const value = parser.number(name, { required: false, min: 0, max });
	if (value === 0 || parser.errors[name]) {
		delete parser.errors[name];
		parser.fail(name, message);
		return null;
	}
	return value;
}

/** The unit form. Floor area and rooms accept the German decimal comma ("72,5"). */
export function parseUnit(form: FormData): ParseResult<UnitInput> {
	const parser = new FormParser<UnitInput>(form);

	const name = parser.raw('name');
	if (!name) parser.fail('name', 'Bitte gib eine Bezeichnung an.');
	else if (name.length > 100) parser.fail('name', 'Die Bezeichnung ist zu lang.');

	const kindValue = parser.raw('kind');
	const kind = unitKinds.find((candidate) => candidate === kindValue);
	if (!kind) parser.fail('kind', 'Bitte wähle eine Art aus.');

	const floorArea = positiveNumber(
		parser,
		'floorArea',
		100_000,
		'Bitte gib die Fläche als positive Zahl in m² an.'
	);
	const floor = parser.optionalText('floor', 50);
	const rooms = positiveNumber(
		parser,
		'rooms',
		100,
		'Bitte gib die Zimmer als positive Zahl an, z. B. 2,5.'
	);
	const notes = parser.optionalText('notes', 2000);

	return parser.result(() => ({
		name,
		kind: kind as UnitKind,
		floorArea,
		floor,
		rooms,
		notes
	}));
}

export type CredentialsInput = {
	email: string;
	password: string;
};

export const MIN_PASSWORD_LENGTH = 10;

/** For registration. The sign-in form only checks that both fields are filled in. */
export function parseCredentials(form: FormData): ParseResult<CredentialsInput> {
	const email = text(form, 'email');
	const password = form.get('password');
	const errors: FieldErrors<CredentialsInput> = {};

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
		errors.email = 'Bitte gib eine gültige E-Mail-Adresse an.';
	}
	if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
		errors.password = `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
	} else if (password.length > 200) {
		errors.password = 'Das Passwort ist zu lang.';
	}

	// The password is never sent back to the form.
	if (Object.keys(errors).length > 0 || typeof password !== 'string') {
		return { ok: false, errors, values: { email } };
	}
	return { ok: true, data: { email, password } };
}
