import { isIsoDate, isIsoMonth } from '../dates';
import { parseCents } from '../money';

// Helpers for parsing FormData in server actions. A parse function builds on FormParser and
// returns a ParseResult, which the action hands back to the form on failure.

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export type ParseResult<T> =
	{ ok: true; data: T } | { ok: false; errors: FieldErrors<T>; values: Record<string, string> };

/** Collects errors while fields are parsed; `result()` builds the ParseResult. */
export class FormParser<T> {
	readonly errors: FieldErrors<T> = {};
	readonly values: Record<string, string> = {};

	constructor(private readonly form: FormData) {}

	/** The trimmed string value of a field, remembered for re-rendering the form. */
	raw(name: string): string {
		const value = this.form.get(name);
		const text = typeof value === 'string' ? value.trim() : '';
		this.values[name] = text;
		return text;
	}

	/** Whether the checkbox or switch was sent. */
	flag(name: string): boolean {
		const value = this.form.get(name);
		const on = value === 'on' || value === 'true' || value === '1';
		this.values[name] = on ? 'on' : '';
		return on;
	}

	fail(name: keyof T, message: string): void {
		if (!this.errors[name]) this.errors[name] = message;
	}

	text(name: keyof T & string, options: { required?: boolean; max?: number } = {}): string {
		const value = this.raw(name);
		const { required = true, max = 200 } = options;
		if (!value && required) this.fail(name, 'Bitte fülle dieses Feld aus.');
		else if (value.length > max) this.fail(name, `Höchstens ${max} Zeichen.`);
		return value;
	}

	/** Empty becomes null, so optional text columns stay null instead of ''. */
	optionalText(name: keyof T & string, max = 200): string | null {
		return this.text(name, { required: false, max }) || null;
	}

	/** Amount in cents. */
	money(
		name: keyof T & string,
		options: { required?: boolean; min?: number; max?: number } = {}
	): number | null {
		const value = this.raw(name);
		const { required = true, min = 0, max = 100_000_000_00 } = options;
		if (!value) {
			if (required) this.fail(name, 'Bitte gib einen Betrag an.');
			return null;
		}
		const cents = parseCents(value);
		if (cents === undefined) this.fail(name, 'Bitte gib einen Betrag an, z. B. 650,00.');
		else if (cents < min) this.fail(name, `Der Betrag darf nicht unter ${min / 100} € liegen.`);
		else if (cents > max) this.fail(name, 'Der Betrag ist zu hoch.');
		return cents ?? null;
	}

	/**
	 * A decimal number; accepts the German comma. Dots are thousands separators only when a
	 * comma follows them ("1.072,5"); without a comma a dot is the decimal point ("72.5").
	 */
	number(
		name: keyof T & string,
		options: { required?: boolean; min?: number; max?: number; integer?: boolean } = {}
	): number | null {
		const value = this.raw(name);
		const { required = true, min = 0, max = 1_000_000_000, integer = false } = options;
		if (!value) {
			if (required) this.fail(name, 'Bitte gib eine Zahl an.');
			return null;
		}
		const parsed = Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value);
		if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
			this.fail(name, integer ? 'Bitte gib eine ganze Zahl an.' : 'Bitte gib eine Zahl an.');
			return null;
		}
		if (parsed < min) this.fail(name, `Der Wert darf nicht unter ${min} liegen.`);
		else if (parsed > max) this.fail(name, `Der Wert darf nicht über ${max} liegen.`);
		return parsed;
	}

	/** ISO date from a `<input type="date">`. */
	date(name: keyof T & string, options: { required?: boolean } = {}): string | null {
		const value = this.raw(name);
		if (!value) {
			if (options.required ?? true) this.fail(name, 'Bitte gib ein Datum an.');
			return null;
		}
		if (!isIsoDate(value)) {
			this.fail(name, 'Bitte gib ein gültiges Datum an.');
			return null;
		}
		return value;
	}

	/** `YYYY-MM` from a `<input type="month">`. */
	month(name: keyof T & string, options: { required?: boolean } = {}): string | null {
		const value = this.raw(name);
		if (!value) {
			if (options.required ?? true) this.fail(name, 'Bitte gib einen Monat an.');
			return null;
		}
		if (!isIsoMonth(value)) {
			this.fail(name, 'Bitte gib einen gültigen Monat an.');
			return null;
		}
		return value;
	}

	/** One of the allowed values, else an error. */
	oneOf<const V extends readonly string[]>(
		name: keyof T & string,
		allowed: V,
		options: { required?: boolean } = {}
	): V[number] | null {
		const value = this.raw(name);
		if (!value) {
			if (options.required ?? true) this.fail(name, 'Bitte wähle einen Eintrag aus.');
			return null;
		}
		const match = allowed.find((candidate) => candidate === value);
		if (!match) this.fail(name, 'Bitte wähle einen gültigen Eintrag aus.');
		return match ?? null;
	}

	/** A record id from a select; existence is checked by the caller against the account. */
	id(name: keyof T & string, options: { required?: boolean } = {}): string | null {
		const value = this.raw(name);
		if (!value) {
			if (options.required ?? true) this.fail(name, 'Bitte wähle einen Eintrag aus.');
			return null;
		}
		if (value.length > 64) this.fail(name, 'Ungültige Auswahl.');
		return value;
	}

	/** All values of a multi-select or checkbox group. */
	ids(name: keyof T & string): string[] {
		const values = this.form
			.getAll(name)
			.filter((value): value is string => typeof value === 'string' && value.length <= 64);
		this.values[name] = values.join(',');
		return values;
	}

	email(name: keyof T & string): string {
		const value = this.raw(name).toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
			this.fail(name, 'Bitte gib eine gültige E-Mail-Adresse an.');
		}
		return value;
	}

	/** An uploaded file, or null when none was chosen. Checks size and that it is not empty. */
	file(
		name: keyof T & string,
		options: { required?: boolean; maxBytes?: number } = {}
	): File | null {
		const value = this.form.get(name);
		const { required = false, maxBytes = 10 * 1024 * 1024 } = options;
		const file = value instanceof File && value.size > 0 && value.name ? value : null;
		if (!file) {
			if (required) this.fail(name, 'Bitte wähle eine Datei aus.');
			return null;
		}
		if (file.size > maxBytes) {
			this.fail(
				name,
				`Die Datei ist zu groß (höchstens ${Math.round(maxBytes / 1024 / 1024)} MB).`
			);
			return null;
		}
		return file;
	}

	/** An IBAN, stored without spaces in upper case; checked with the ISO 7064 checksum. */
	iban(name: keyof T & string, options: { required?: boolean } = {}): string | null {
		const value = this.raw(name).replace(/\s+/g, '').toUpperCase();
		if (!value) {
			if (options.required ?? true) this.fail(name, 'Bitte gib eine IBAN an.');
			return null;
		}
		if (!isValidIban(value)) {
			this.fail(name, 'Bitte gib eine gültige IBAN an.');
			return null;
		}
		return value;
	}

	get hasErrors(): boolean {
		return Object.keys(this.errors).length > 0;
	}

	/** The result for the given data, or the errors when a field failed. */
	result(data: () => T): ParseResult<T> {
		if (this.hasErrors) return { ok: false, errors: this.errors, values: this.values };
		return { ok: true, data: data() };
	}
}

/** ISO 13616 check: letters to digits, move the first four characters to the end, mod 97 = 1. */
export function isValidIban(iban: string): boolean {
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
	const rearranged = iban.slice(4) + iban.slice(0, 4);
	let remainder = 0;
	for (const char of rearranged) {
		const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
		for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder === 1;
}

/** Builds a FormData from a plain object, for tests. Files are appended as they are. */
export function formDataOf(entries: Record<string, string | string[] | File>): FormData {
	const data = new FormData();
	for (const [name, value] of Object.entries(entries)) {
		if (Array.isArray(value)) for (const item of value) data.append(name, item);
		else data.set(name, value);
	}
	return data;
}
