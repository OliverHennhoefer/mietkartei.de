import { isIsoDate } from '../../dates';

// The inputs of an API operation, described once as a small subset of JSON Schema: the MCP server
// publishes it as the tool's inputSchema, and parseInput checks both the tool arguments and the
// query and path of a REST call against it.

export type Field =
	| {
			type: 'string';
			description: string;
			format?: 'date';
			enum?: readonly string[];
			maxLength?: number;
	  }
	| { type: 'integer'; description: string; minimum?: number; maximum?: number }
	| { type: 'number'; description: string; minimum?: number; maximum?: number }
	| { type: 'boolean'; description: string };

export type InputSchema = {
	type: 'object';
	properties: Record<string, Field>;
	required?: readonly string[];
	additionalProperties: false;
};

export function schema(
	properties: Record<string, Field> = {},
	required: string[] = []
): InputSchema {
	return { type: 'object', properties, required, additionalProperties: false };
}

export class InputError extends Error {}

/**
 * Checks the input against the schema and returns it typed. With `fromText`, values arrive as
 * strings (query and path of a REST call) and integers and booleans are converted first. Blank
 * strings are dropped, as if the parameter was not sent.
 */
export function parseInput(
	input: unknown,
	schema: InputSchema,
	fromText = false
): Record<string, string | number | boolean> {
	input ??= {};
	if (typeof input !== 'object' || Array.isArray(input)) {
		throw new InputError('The input must be an object.');
	}
	const result: Record<string, string | number | boolean> = {};
	for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
		const field = schema.properties[name];
		if (!field) throw new InputError(`Unknown parameter "${name}".`);
		// A blank string counts as left out, so an empty optional id never reaches a foreign key.
		if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) continue;
		result[name] = parseValue(name, raw, field, fromText);
	}
	for (const name of schema.required ?? []) {
		if (!(name in result)) throw new InputError(`Missing parameter "${name}".`);
	}
	return result;
}

function parseValue(name: string, raw: unknown, field: Field, fromText: boolean) {
	switch (field.type) {
		case 'string': {
			if (typeof raw !== 'string') throw new InputError(`"${name}" must be a string.`);
			const value = raw.trim();
			if (field.maxLength !== undefined && value.length > field.maxLength) {
				throw new InputError(`"${name}" may have at most ${field.maxLength} characters.`);
			}
			if (field.format === 'date' && !isIsoDate(value)) {
				throw new InputError(`"${name}" must be a date as YYYY-MM-DD.`);
			}
			if (field.enum && !field.enum.includes(value)) {
				throw new InputError(`"${name}" must be one of ${field.enum.join(', ')}.`);
			}
			return value;
		}
		case 'integer':
		case 'number': {
			const pattern = field.type === 'integer' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
			const value = fromText && typeof raw === 'string' && pattern.test(raw) ? Number(raw) : raw;
			if (field.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
				throw new InputError(`"${name}" must be an integer.`);
			}
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				throw new InputError(`"${name}" must be a number.`);
			}
			if (field.minimum !== undefined && value < field.minimum) {
				throw new InputError(`"${name}" must be at least ${field.minimum}.`);
			}
			if (field.maximum !== undefined && value > field.maximum) {
				throw new InputError(`"${name}" must be at most ${field.maximum}.`);
			}
			return value;
		}
		case 'boolean': {
			const value = fromText && (raw === 'true' || raw === 'false') ? raw === 'true' : raw;
			if (typeof value !== 'boolean') throw new InputError(`"${name}" must be true or false.`);
			return value;
		}
	}
}
