import { describe, expect, it } from 'vitest';
import { InputError, parseInput, schema } from './input';

const fields = schema(
	{
		id: { type: 'string', description: 'id', maxLength: 5 },
		from: { type: 'string', format: 'date', description: 'from' },
		status: { type: 'string', enum: ['open', 'done'], description: 'status' },
		year: { type: 'integer', minimum: 1900, maximum: 2100, description: 'year' },
		share: { type: 'number', minimum: 0, maximum: 1000, description: 'share' },
		all: { type: 'boolean', description: 'all' }
	},
	['id']
);

describe('parseInput', () => {
	it('accepts typed values and leaves out empty ones', () => {
		expect(
			parseInput({ id: ' abc ', from: '2026-01-31', year: 2026, all: false, status: null }, fields)
		).toEqual({ id: 'abc', from: '2026-01-31', year: 2026, all: false });
	});

	it('drops blank strings', () => {
		expect(parseInput({ id: 'a', status: ' ', from: '' }, fields)).toEqual({ id: 'a' });
	});

	it('converts the text of a query string', () => {
		expect(parseInput({ id: 'a', year: '2026', all: 'true', status: '' }, fields, true)).toEqual({
			id: 'a',
			year: 2026,
			all: true
		});
	});

	it('takes decimals for a number, as JSON or as text', () => {
		expect(parseInput({ id: 'a', share: 85.5 }, fields)).toEqual({ id: 'a', share: 85.5 });
		expect(parseInput({ id: 'a', share: '85.5' }, fields, true)).toEqual({ id: 'a', share: 85.5 });
	});

	it.each([
		[{}, 'Missing parameter "id".'],
		[{ id: '  ' }, 'Missing parameter "id".'],
		[{ id: 'a', other: 1 }, 'Unknown parameter "other".'],
		[{ id: 'abcdef' }, 'at most 5 characters'],
		[{ id: 'a', from: '31.01.2026' }, 'YYYY-MM-DD'],
		[{ id: 'a', status: 'late' }, 'one of open, done'],
		[{ id: 'a', year: '2026' }, 'must be an integer'],
		[{ id: 'a', year: 2026.5 }, 'must be an integer'],
		[{ id: 'a', year: 1800 }, 'at least 1900'],
		[{ id: 'a', year: 2101 }, 'at most 2100'],
		[{ id: 'a', share: '85,5' }, 'must be a number'],
		[{ id: 'a', share: 1000.5 }, 'at most 1000'],
		[{ id: 'a', all: 'yes' }, 'true or false'],
		[{ id: 1 }, 'must be a string']
	])('refuses %j', (input, message) => {
		expect(() => parseInput(input, fields)).toThrow(InputError);
		expect(() => parseInput(input, fields)).toThrow(message);
	});

	it('takes only true and false as text for a boolean', () => {
		expect(parseInput({ id: 'a', all: 'false' }, fields, true)).toEqual({ id: 'a', all: false });
		expect(() => parseInput({ id: 'a', all: 'ja' }, fields, true)).toThrow('true or false');
	});

	it('refuses input that is not an object', () => {
		expect(() => parseInput([], fields)).toThrow('must be an object');
		expect(() => parseInput('x', fields)).toThrow('must be an object');
		expect(parseInput(undefined, schema())).toEqual({});
	});
});
