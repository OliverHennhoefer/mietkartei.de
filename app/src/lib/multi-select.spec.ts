import { describe, expect, it } from 'vitest';
import { matchOptions, searchKey } from './multi-select';

const options = [
	{ value: 'a', label: 'Anna Schmidt', hint: 'anna.schmidt@example.org' },
	{ value: 'b', label: 'Murat Yılmaz' },
	{ value: 'c', label: 'Jürgen Groß' }
];
const values = (query: string, chosen: string[] = []) =>
	matchOptions(options, chosen, query).map((option) => option.value);

describe('searchKey', () => {
	it('ignores case and accents', () => {
		expect(searchKey('Jürgen Groß')).toBe('jurgen gross');
		expect(searchKey('Yılmaz')).toBe('yilmaz');
	});
});

describe('matchOptions', () => {
	it('lists every option not chosen for an empty query', () => {
		expect(values('')).toEqual(['a', 'b', 'c']);
		expect(values('  ', ['b'])).toEqual(['a', 'c']);
	});

	it('finds options by every word, in any order, in the label or the hint', () => {
		expect(values('schmidt anna')).toEqual(['a']);
		expect(values('example.org')).toEqual(['a']);
		expect(values('yilmaz')).toEqual(['b']);
		expect(values('jurgen gross')).toEqual(['c']);
		expect(values('anna yilmaz')).toEqual([]);
	});

	it('leaves out the chosen options', () => {
		expect(values('anna', ['a'])).toEqual([]);
	});
});
