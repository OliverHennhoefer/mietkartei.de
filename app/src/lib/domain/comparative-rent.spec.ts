import { describe, expect, it } from 'vitest';
import {
	cappedRent,
	cappingBase,
	comparativeEffectiveFrom,
	comparativeLetterRows,
	comparativeLetterText,
	comparativeSituation,
	comparisonLimit,
	consentDeadline,
	demandProblem,
	lastBaseRentChange,
	lawsuitDeadline,
	type ComparativeDemand
} from './comparative-rent';
import type { HistoryChange } from './index-rent';

function change(
	validFrom: string,
	baseRent: number,
	overrides: Partial<HistoryChange> = {}
): HistoryChange {
	return {
		validFrom,
		baseRent,
		parkingRent: 0,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 8000,
		status: 'approved',
		reason: validFrom === '2022-01-01' ? 'initial' : 'manual',
		indexMonth: null,
		indexValue: null,
		indexBaseYear: '2020',
		...overrides
	};
}

const flat = { kind: 'residential' as const, rentModel: 'fixed' as const, floorArea: 80 };

const demand: ComparativeDemand = {
	deliveredOn: '2026-03-10',
	baseRent: 72000,
	comparativeRent: 950,
	cappingPercent: 20,
	comparisonSource: 'rent_index',
	comparisonDetails: 'Mietspiegel 2026, Feld C2, Spanne 8,10 – 10,40 € je m².'
};

describe('dates of § 558', () => {
	it('lets the tenant consent until the end of the second month and makes the rent due from the third', () => {
		// Received on 10 March: consent by 31 May, due from 1 June, suing until 31 August.
		expect(consentDeadline('2026-03-10')).toBe('2026-05-31');
		expect(comparativeEffectiveFrom('2026-03-10')).toBe('2026-06-01');
		expect(lawsuitDeadline('2026-03-10')).toBe('2026-08-31');
	});

	it('waits for 15 months of unchanged rent', () => {
		expect(comparativeEffectiveFrom('2026-03-10', '2025-04-01')).toBe('2026-07-01');
		expect(comparativeEffectiveFrom('2026-03-10', '2024-01-01')).toBe('2026-06-01');
	});

	it('takes the last change of the Kaltmiete, ignoring § 560 changes and proposals', () => {
		const changes = [
			change('2022-01-01', 60000),
			change('2023-05-01', 65000),
			change('2024-02-01', 65000, { reason: 'statement', operatingCostPrepayment: 17000 }),
			change('2026-06-01', 70000, { status: 'proposed', reason: 'comparative' })
		];
		expect(lastBaseRentChange(changes)).toBe('2023-05-01');
		expect(lastBaseRentChange([])).toBeUndefined();
	});
});

describe('limits of § 558', () => {
	it('caps the rise in three years and keeps below the Vergleichsmiete', () => {
		const changes = [change('2022-01-01', 60000), change('2024-01-01', 65000)];
		// Three years before 1 June 2026 the rent was 600 €.
		expect(cappingBase(changes, '2026-06-01')).toBe(60000);
		// A lease younger than three years starts from its first rent.
		expect(cappingBase([change('2025-01-01', 70000)], '2026-06-01')).toBe(70000);
		expect(cappingBase([], '2026-06-01')).toBe(0);
		expect(cappedRent(60000, 20)).toBe(72000);
		expect(cappedRent(60000, 15)).toBe(69000);
		expect(comparisonLimit(950, 80)).toBe(76000);
		expect(comparisonLimit(955, 72.5)).toBe(69237);
	});

	it('refuses commercial, Staffel and index leases, a second demand and a missing area', () => {
		const changes = [change('2022-01-01', 60000)];
		const refusal = (lease: Parameters<typeof comparativeSituation>[0], rows = changes) =>
			comparativeSituation(lease, rows, '2026-03-10').refusal;
		expect(refusal(flat)).toBeUndefined();
		expect(refusal({ ...flat, kind: 'commercial' })).toContain('nur bei Wohnraum');
		expect(refusal({ ...flat, rentModel: 'graduated' })).toContain('§ 557a');
		expect(refusal({ ...flat, rentModel: 'indexed' })).toContain('§ 557b');
		expect(refusal({ ...flat, floorArea: null })).toContain('Wohnfläche');
		expect(refusal(flat, [])).toContain('fehlt die Miete');
		expect(
			refusal(flat, [
				...changes,
				change('2026-06-01', 70000, { status: 'proposed', reason: 'comparative' })
			])
		).toContain('schon ein Erhöhungsverlangen');
	});

	it('checks a demand against the year, the current rent, the cap and the Vergleichsmiete', () => {
		const changes = [change('2022-01-01', 60000), change('2025-06-01', 65000)];
		const check = (overrides: Partial<ComparativeDemand>) => {
			const input = { ...demand, ...overrides };
			const situation = comparativeSituation(flat, changes, input.deliveredOn);
			return demandProblem(flat, situation, input);
		};
		// Raised on 1 June 2025: no demand before 1 June 2026.
		expect(check({})).toMatchObject({ field: 'deliveredOn' });
		expect(check({ deliveredOn: '2026-06-01' })).toBeUndefined();
		expect(check({ deliveredOn: '2026-06-01', baseRent: 65000 })).toMatchObject({
			field: 'baseRent',
			message: expect.stringContaining('über der bisherigen')
		});
		// From 600 € three years before 1 September 2026, 15 % allow 690 €.
		expect(check({ deliveredOn: '2026-06-01', cappingPercent: 15 })).toMatchObject({
			message: expect.stringContaining('Kappungsgrenze von 15 %')
		});
		expect(check({ deliveredOn: '2026-06-01', comparativeRent: 850 })).toMatchObject({
			message: expect.stringContaining('höchstens 680,00')
		});
	});
});

describe('§ 558 with a garage rented with the flat', () => {
	// 650 € Kaltmiete, of which 50 € for the garage, since 2022; 600 € for the flat of 80 m².
	const changes = [change('2022-01-01', 65000, { parkingRent: 5000 })];

	it('caps and compares the rent of the flat only, the garage share added on top', () => {
		const situation = comparativeSituation(flat, changes, '2026-03-10');
		expect(situation).toMatchObject({ currentBaseRent: 65000, parkingRent: 5000, capBase: 60000 });
		// 20 % on the flat's 600 €, plus the unchanged 50 €.
		expect(situation.caps).toEqual({ 20: 77000, 15: 74000 });
		const check = (baseRent: number, comparativeRent = 950) =>
			demandProblem(flat, situation, { ...demand, baseRent, comparativeRent });
		expect(check(77000)).toBeUndefined();
		expect(check(77001)).toMatchObject({
			message: expect.stringContaining(
				'höchstens 770,00\u00a0€, mit 50,00\u00a0€ für Garage/Stellplatz'
			)
		});
		// 8,50 € × 80 m² = 680 € for the flat: 730 € in all.
		expect(check(73000, 850)).toBeUndefined();
		expect(check(73001, 850)).toMatchObject({
			message: expect.stringContaining('höchstens 730,00\u00a0€')
		});
	});

	it('names the garage share in the letter and leaves it out per m²', () => {
		const oldRent = changes[0];
		const content = {
			unitName: 'EG links',
			floorArea: 80,
			tenants: [{ salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' }],
			oldRent,
			newRent: { ...oldRent, validFrom: '2026-06-01', baseRent: 77000 },
			capBase: 60000,
			lastChange: '2022-01-01',
			deliveredOn: '2026-03-10',
			demand
		};
		const text = comparativeLetterText(content).replaceAll('\u00a0', ' ');
		expect(text).toContain('von 650,00 € um 120,00 € auf 770,00 € im Monat zuzustimmen');
		expect(text).toContain('Davon entfallen wie bisher 50,00 € auf die mitvermietete Garage');
		expect(text).toContain('Kaltmiete für die Wohnung von 7,50 € auf 9,00 € je m²');
		expect(text).toContain('um 20,00 % und bleibt innerhalb der Kappungsgrenze');
		expect(
			comparativeLetterRows(content).map((row) => row.map((cell) => cell.replaceAll('\u00a0', ' ')))
		).toEqual([
			['Kaltmiete', '650,00 €', '770,00 €'],
			['davon Garage/Stellplatz', '50,00 €', '50,00 €'],
			['Kaltmiete der Wohnung je m²', '7,50 €', '9,00 €'],
			['Gesamtmiete', '880,00 €', '1.000,00 €']
		]);
	});
});

describe('the letter of § 558', () => {
	it('names the increase, the justification, the cap and the deadlines', () => {
		const oldRent = change('2022-01-01', 60000);
		const content = {
			unitName: 'EG links',
			floorArea: 80,
			tenants: [{ salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' }],
			oldRent,
			newRent: { ...oldRent, validFrom: '2026-06-01', baseRent: 72000 },
			capBase: 60000,
			lastChange: '2022-01-01',
			deliveredOn: '2026-03-10',
			demand
		};
		// formatCents and the percentages use non-breaking spaces.
		const text = comparativeLetterText(content).replaceAll('\u00a0', ' ');
		expect(text.split('\n\n')).toHaveLength(5);
		expect(text).toContain('Guten Tag Frau Muster,');
		expect(text).toContain('von 600,00 € um 120,00 € auf 720,00 € im Monat zuzustimmen');
		expect(text).toContain(
			'Sie ergibt sich aus dem Mietspiegel: Mietspiegel 2026, Feld C2, Spanne 8,10 – 10,40 € je m². Bei'
		);
		expect(text).toContain('von 7,50 € auf 9,00 € je m²');
		expect(text).toContain('um 20,00 % und bleibt innerhalb der Kappungsgrenze von 20 %');
		expect(text).toContain('bis zum 31.05.2026 in Textform zu');
		expect(text).toContain('ab dem 01.06.2026 zu zahlen');
		expect(text).toContain('Gesamtmiete beträgt dann 950,00 €');
		expect(
			comparativeLetterRows(content).map((row) => row.map((cell) => cell.replaceAll('\u00a0', ' ')))
		).toEqual([
			['Kaltmiete', '600,00 €', '720,00 €'],
			['Kaltmiete je m²', '7,50 €', '9,00 €'],
			['Gesamtmiete', '830,00 €', '950,00 €']
		]);
	});
});
