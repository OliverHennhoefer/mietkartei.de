import { describe, expect, it } from 'vitest';
import { accountLengthOf, datevBuchungsstapel, windows1252 } from './datev';

const header = {
	advisorNumber: '29098',
	clientNumber: '55003',
	fiscalYearStart: '2025-01-01',
	accountLength: 4,
	from: '2025-01-01',
	to: '2025-12-31',
	label: 'Bank 2025',
	createdAt: new Date('2026-02-03T04:05:06.789Z')
};

describe('datevBuchungsstapel', () => {
	it('writes the EXTF header, the columns and one line per booking', () => {
		const text = datevBuchungsstapel(header, [
			{ date: '2025-03-01', amount: 70000, account: '1200', contraAccount: '8005', text: 'Miete' },
			{
				date: '2025-03-15',
				amount: -21012,
				account: '1200',
				contraAccount: '4401',
				text: 'Stadtkasse "Grundsteuer";\nQ1'
			}
		]);
		const lines = text.split('\r\n');
		expect(lines).toHaveLength(5);
		expect(lines[4]).toBe('');
		const fields = lines[0].split(';');
		expect(fields).toHaveLength(31);
		expect(fields.slice(0, 6)).toEqual([
			'"EXTF"',
			'700',
			'21',
			'"Buchungsstapel"',
			'13',
			'20260203040506789'
		]);
		expect(fields.slice(10, 17)).toEqual([
			'29098',
			'55003',
			'20250101',
			'4',
			'20250101',
			'20251231',
			'"Bank 2025"'
		]);
		expect(fields[21]).toBe('"EUR"');
		expect(lines[1].split(';')).toHaveLength(14);
		expect(lines[2]).toBe('700,00;"S";"EUR";;;"";1200;8005;"";0103;"";"";;"Miete"');
		expect(lines[3]).toBe(
			'210,12;"H";"EUR";;;"";1200;4401;"";1503;"";"";;"Stadtkasse ""Grundsteuer"" Q1"'
		);
	});

	it('cuts the Buchungstext to 60 characters', () => {
		const text = datevBuchungsstapel(header, [
			{
				date: '2025-01-02',
				amount: 1,
				account: '1200',
				contraAccount: '1890',
				text: 'x'.repeat(80)
			}
		]);
		expect(text.split('\r\n')[2]).toContain(`"${'x'.repeat(60)}"`);
		expect(text.split('\r\n')[2].startsWith('0,01;"S"')).toBe(true);
	});
});

describe('windows1252', () => {
	it('keeps umlauts and the euro sign in one byte each and replaces the rest', () => {
		expect([...windows1252('Mü€„x“ß✓')]).toEqual([0x4d, 0xfc, 0x80, 0x84, 0x78, 0x93, 0xdf, 0x3f]);
	});
});

describe('accountLengthOf', () => {
	it('takes the longest number, at least 4, and reports the others', () => {
		expect(accountLengthOf(['1200', '8005'])).toEqual({ length: 4, uneven: [] });
		expect(accountLengthOf(['1200', '84000', '1200'])).toEqual({ length: 5, uneven: ['1200'] });
		expect(accountLengthOf([])).toEqual({ length: 4, uneven: [] });
	});
});
