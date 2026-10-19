import { unitKinds, type UnitKind } from './units';

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export type ParseResult<T> =
	{ ok: true; data: T } | { ok: false; errors: FieldErrors<T>; values: Record<string, string> };

export type PropertyInput = {
	name: string;
	street: string;
	postalCode: string;
	city: string;
};

export type UnitInput = {
	name: string;
	kind: UnitKind;
	floorArea: number | null;
};

function text(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

function values(form: FormData, names: string[]): Record<string, string> {
	return Object.fromEntries(names.map((name) => [name, text(form, name)]));
}

export function parseProperty(form: FormData): ParseResult<PropertyInput> {
	const input = values(form, ['name', 'street', 'postalCode', 'city']);
	const errors: FieldErrors<PropertyInput> = {};

	if (!input.name) errors.name = 'Bitte gib eine Bezeichnung an.';
	else if (input.name.length > 100) errors.name = 'Die Bezeichnung ist zu lang.';
	if (!input.street) errors.street = 'Bitte gib Straße und Hausnummer an.';
	if (!/^\d{5}$/.test(input.postalCode)) errors.postalCode = 'Die Postleitzahl hat fünf Ziffern.';
	if (!input.city) errors.city = 'Bitte gib den Ort an.';

	if (Object.keys(errors).length > 0) return { ok: false, errors, values: input };
	return {
		ok: true,
		data: {
			name: input.name,
			street: input.street,
			postalCode: input.postalCode,
			city: input.city
		}
	};
}

export function parseUnit(form: FormData): ParseResult<UnitInput> {
	const input = values(form, ['name', 'kind', 'floorArea']);
	const errors: FieldErrors<UnitInput> = {};

	if (!input.name) errors.name = 'Bitte gib eine Bezeichnung an.';
	else if (input.name.length > 100) errors.name = 'Die Bezeichnung ist zu lang.';

	const kind = unitKinds.find((candidate) => candidate === input.kind);
	if (!kind) errors.kind = 'Bitte wähle eine Art aus.';

	// Accept the German decimal comma, e.g. "72,5".
	let floorArea: number | null = null;
	if (input.floorArea) {
		floorArea = Number(input.floorArea.replace(',', '.'));
		if (!Number.isFinite(floorArea) || floorArea <= 0 || floorArea > 100_000) {
			errors.floorArea = 'Bitte gib die Fläche als positive Zahl in m² an.';
		}
	}

	if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors, values: input };
	return { ok: true, data: { name: input.name, kind, floorArea } };
}
