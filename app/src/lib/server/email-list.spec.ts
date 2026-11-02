import { describe, expect, it } from 'vitest';
import { parseEmailList } from './email-list';

describe('parseEmailList', () => {
	it('reads addresses separated by commas, semicolons or whitespace, in lower case', () => {
		expect(
			parseEmailList(
				' Oliver@Example.org,zweite@example.org\nDritte@example.org; vierte@example.org '
			)
		).toEqual([
			'oliver@example.org',
			'zweite@example.org',
			'dritte@example.org',
			'vierte@example.org'
		]);
		expect(parseEmailList('')).toEqual([]);
		expect(parseEmailList(' , ; ')).toEqual([]);
	});
});
