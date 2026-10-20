import { describe, expect, it } from 'vitest';
import { FormParser, formDataOf, isValidIban } from './fields';

type Sample = {
	name: string;
	note: string | null;
	rent: number;
	area: number | null;
	start: string;
	kind: 'a' | 'b';
	tenantIds: string[];
	active: boolean;
};

function parse(entries: Record<string, string | string[]>) {
	const parser = new FormParser<Sample>(formDataOf(entries));
	const name = parser.text('name', { max: 10 });
	const note = parser.optionalText('note');
	const rent = parser.money('rent');
	const area = parser.number('area', { required: false });
	const start = parser.date('start');
	const kind = parser.oneOf('kind', ['a', 'b'] as const);
	const tenantIds = parser.ids('tenantIds');
	const active = parser.flag('active');
	return parser.result(() => ({
		name,
		note,
		rent: rent!,
		area,
		start: start!,
		kind: kind!,
		tenantIds,
		active
	}));
}

describe('FormParser', () => {
	it('parses every field type', () => {
		const result = parse({
			name: ' Haus ',
			note: '',
			rent: '650,00',
			area: '72,5',
			start: '2026-01-01',
			kind: 'b',
			tenantIds: ['t1', 't2'],
			active: 'on'
		});
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'Haus',
				note: null,
				rent: 65000,
				area: 72.5,
				start: '2026-01-01',
				kind: 'b',
				tenantIds: ['t1', 't2'],
				active: true
			}
		});
	});

	it('collects one error per field and echoes the values', () => {
		const result = parse({
			name: 'viel zu langer Name',
			rent: 'abc',
			area: 'x',
			start: '2026-02-30',
			kind: 'c'
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['area', 'kind', 'name', 'rent', 'start']);
		expect(result.values.rent).toBe('abc');
		expect(result.values.active).toBe('');
	});
});

describe('file and iban', () => {
	it('accepts a file within the limit and rejects an oversized one', () => {
		const small = new File(['hallo'], 'beleg.pdf', { type: 'application/pdf' });
		const big = new File([new Uint8Array(11)], 'gross.pdf', { type: 'application/pdf' });
		const ok = new FormParser<{ file: File | null }>(formDataOf({ file: small }));
		expect(ok.file('file')?.name).toBe('beleg.pdf');
		expect(ok.hasErrors).toBe(false);

		const tooBig = new FormParser<{ file: File | null }>(formDataOf({ file: big }));
		expect(tooBig.file('file', { maxBytes: 10 })).toBeNull();
		expect(tooBig.errors.file).toMatch(/zu groß/);

		const missing = new FormParser<{ file: File | null }>(formDataOf({}));
		expect(missing.file('file')).toBeNull();
		expect(missing.hasErrors).toBe(false);
		expect(missing.file('file', { required: true })).toBeNull();
		expect(missing.errors.file).toMatch(/Datei/);
	});

	it('validates the IBAN checksum and normalizes spaces', () => {
		expect(isValidIban('DE89370400440532013000')).toBe(true);
		expect(isValidIban('DE89370400440532013001')).toBe(false);
		expect(isValidIban('DE')).toBe(false);
		const parser = new FormParser<{ iban: string | null }>(
			formDataOf({ iban: 'de89 3704 0044 0532 0130 00' })
		);
		expect(parser.iban('iban')).toBe('DE89370400440532013000');
		const wrong = new FormParser<{ iban: string | null }>(formDataOf({ iban: 'DE00 1234' }));
		expect(wrong.iban('iban')).toBeNull();
		expect(wrong.errors.iban).toMatch(/IBAN/);
	});
});
