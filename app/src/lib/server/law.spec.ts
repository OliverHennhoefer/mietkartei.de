import { describe, expect, it } from 'vitest';
import { deadlineLegalBasis } from './deadlines';
import { cite, findLawSection, listLawSections } from './law';

describe('law', () => {
	it('cites a section with its detail and law', () => {
		expect(cite('bgb-556', 'Abs. 3')).toEqual({ section: 'bgb-556', citation: '§ 556 Abs. 3 BGB' });
		expect(cite('heizkostenv-9b')).toEqual({
			section: 'heizkostenv-9b',
			citation: '§ 9b HeizkostenV'
		});
	});

	it('finds a section by id or by citation', () => {
		expect(findLawSection('bgb-556a')).toMatchObject({ law: 'BGB', section: '556a' });
		expect(findLawSection('§ 556 Abs. 3 Satz 2 BGB')).toMatchObject({ id: 'bgb-556' });
		expect(findLawSection('§ 556a BGB')).toMatchObject({ id: 'bgb-556a' });
		expect(findLawSection('§ 9a Abs. 2 HeizKV')).toMatchObject({ id: 'heizkostenv-9a' });
		expect(findLawSection('CO2KostAufG § 6')).toMatchObject({ id: 'co2kostaufg-6' });
		expect(findLawSection('§ 6 EStG')).toMatchObject({ id: 'estg-6' });
		expect(findLawSection('§ 1 BGB')).toBeUndefined();
		expect(findLawSection('§ 556')).toBeUndefined();
	});

	it('lists every section under its law', () => {
		const laws = listLawSections();
		expect(laws.map((law) => law.abbreviation)).toEqual([
			'BGB',
			'BetrKV',
			'HeizkostenV',
			'CO2KostAufG',
			'EStG'
		]);
		for (const law of laws) {
			expect(law.sections.length).toBeGreaterThan(0);
			for (const section of law.sections) expect(section).not.toHaveProperty('text');
		}
	});

	it('names the basis of the statutory deadlines', () => {
		expect(deadlineLegalBasis.statement).toEqual([
			{ section: 'bgb-556', citation: '§ 556 Abs. 3 Satz 2 und 3 BGB' }
		]);
		expect(deadlineLegalBasis.insurance_notice).toEqual([]);
	});
});
