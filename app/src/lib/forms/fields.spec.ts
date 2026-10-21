import { describe, expect, it } from 'vitest';
import { FormParser, formDataOf, isValidIban } from './fields';

type Sample = {
	name: string;
	note: string | null;
	area: number | null;
	count: number;
	kind: 'a' | 'b';
};

function parse(entries: Record<string, string>) {
	const parser = new FormParser<Sample>(formDataOf(entries));
	const name = parser.text('name', { max: 10 });
	const note = parser.optionalText('note');
	const area = parser.number('area', { required: false });
	const count = parser.number('count', { integer: true, max: 10 });
	const kind = parser.oneOf('kind', ['a', 'b'] as const);
	return parser.result(() => ({ name, note, area, count: count!, kind: kind! }));
}

describe('FormParser', () => {
	it('parses every field type', () => {
		const result = parse({ name: ' Haus ', note: '', area: '1.072,5', count: '3', kind: 'b' });
		expect(result).toEqual({
			ok: true,
			data: { name: 'Haus', note: null, area: 1072.5, count: 3, kind: 'b' }
		});
	});

	it('reads a dot as the decimal point when there is no comma', () => {
		const result = parse({ name: 'Haus', area: '72.5', count: '3', kind: 'a' });
		expect(result.ok && result.data.area).toBe(72.5);
	});

	it('collects one error per field and echoes the values', () => {
		const result = parse({ name: 'viel zu langer Name', area: 'x', count: '2,5', kind: 'c' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			name: 'Höchstens 10 Zeichen.',
			area: 'Bitte gib eine Zahl an.',
			count: 'Bitte gib eine ganze Zahl an.',
			kind: 'Bitte wähle einen gültigen Eintrag aus.'
		});
		expect(result.values).toMatchObject({ name: 'viel zu langer Name', area: 'x', note: '' });
	});

	it('reports missing required fields and values out of range', () => {
		const missing = parse({ name: '', count: '', kind: '' });
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(missing.errors).toEqual({
			name: 'Bitte fülle dieses Feld aus.',
			count: 'Bitte gib eine Zahl an.',
			kind: 'Bitte wähle einen Eintrag aus.'
		});

		const range = parse({ name: 'Haus', area: '-1', count: '11', kind: 'a' });
		expect(range.ok).toBe(false);
		if (range.ok) return;
		expect(range.errors).toEqual({
			area: 'Der Wert darf nicht unter 0 liegen.',
			count: 'Der Wert darf nicht über 10 liegen.'
		});
	});
});

type Lease = {
	unitId: string;
	tenantIds: string[];
	rent: number;
	start: string;
	email: string;
	active: boolean;
};

function parseLease(entries: Record<string, string | string[]>) {
	const parser = new FormParser<Lease>(formDataOf(entries));
	const unitId = parser.id('unitId');
	const tenantIds = parser.ids('tenantIds');
	const rent = parser.money('rent');
	const start = parser.date('start');
	const email = parser.email('email');
	const active = parser.flag('active');
	return parser.result(() => ({
		unitId: unitId!,
		tenantIds,
		rent: rent!,
		start: start!,
		email,
		active
	}));
}

describe('FormParser for ids, money, dates, email and flags', () => {
	it('parses German amounts, dates, several ids and a ticked checkbox', () => {
		const result = parseLease({
			unitId: 'u1',
			tenantIds: ['t1', 't2'],
			rent: '1.250,50',
			start: '2026-01-01',
			email: 'Erika@Example.org',
			active: 'on'
		});
		expect(result).toEqual({
			ok: true,
			data: {
				unitId: 'u1',
				tenantIds: ['t1', 't2'],
				rent: 125050,
				start: '2026-01-01',
				email: 'erika@example.org',
				active: true
			}
		});
	});

	it('rejects bad values and echoes them, a missing checkbox as empty', () => {
		const result = parseLease({ rent: 'abc', start: '2026-02-30', email: 'erika@' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			unitId: 'Bitte wähle einen Eintrag aus.',
			rent: 'Bitte gib einen Betrag an, z. B. 650,00.',
			start: 'Bitte gib ein gültiges Datum an.',
			email: 'Bitte gib eine gültige E-Mail-Adresse an.'
		});
		expect(result.values).toMatchObject({ rent: 'abc', tenantIds: '', active: '' });
	});

	it('checks the amount range and requires the amount and the date', () => {
		const result = parseLease({ unitId: 'u1', rent: '-1', email: 'a@b.de' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			rent: 'Der Betrag darf nicht unter 0 € liegen.',
			start: 'Bitte gib ein Datum an.'
		});
		const missing = parseLease({ unitId: 'u1', start: '2026-01-01', email: 'a@b.de' });
		expect(missing.ok || missing.errors).toEqual({ rent: 'Bitte gib einen Betrag an.' });
	});
});

describe('FormParser.ids', () => {
	it('accepts up to 1000 ids and refuses more', () => {
		const parse = (count: number) => {
			const parser = new FormParser<{ unitIds: string[] }>(
				formDataOf({ unitIds: Array.from({ length: count }, (_, index) => `u${index}`) })
			);
			const unitIds = parser.ids('unitIds');
			return parser.result(() => ({ unitIds }));
		};
		const limit = parse(1000);
		expect(limit.ok && limit.data.unitIds).toHaveLength(1000);
		expect(parse(1001)).toEqual({
			ok: false,
			errors: { unitIds: 'Höchstens 1000 Einträge.' },
			values: { unitIds: '' }
		});
	});
});

describe('FormParser.month', () => {
	it('reads YYYY-MM, refuses other values and may be optional', () => {
		const parse = (entries: Record<string, string>, required?: boolean) => {
			const parser = new FormParser<{ month: string }>(formDataOf(entries));
			const month = parser.month('month', { required });
			return parser.result(() => ({ month: month! }));
		};
		expect(parse({ month: '2026-01' })).toEqual({ ok: true, data: { month: '2026-01' } });
		expect(parse({ month: '2026-13' })).toMatchObject({
			ok: false,
			errors: { month: 'Bitte gib einen gültigen Monat an.' }
		});
		expect(parse({})).toMatchObject({ ok: false, errors: { month: 'Bitte gib einen Monat an.' } });
		expect(parse({}, false)).toEqual({ ok: true, data: { month: null } });
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
