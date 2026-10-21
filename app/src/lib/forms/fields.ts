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

	get hasErrors(): boolean {
		return Object.keys(this.errors).length > 0;
	}

	/** The result for the given data, or the errors when a field failed. */
	result(data: () => T): ParseResult<T> {
		if (this.hasErrors) return { ok: false, errors: this.errors, values: this.values };
		return { ok: true, data: data() };
	}
}
