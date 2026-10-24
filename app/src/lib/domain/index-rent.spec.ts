import { describe, expect, it } from 'vitest';
import {
	effectiveFrom,
	formatIndexValue,
	formatPercent,
	greeting,
	indexLetterRows,
	indexLetterText,
	indexProposal,
	indexSituation,
	latestIndex,
	letterFigures,
	nextGraduatedStepAllowed,
	referenceIndex,
	waitingPeriodEnd,
	type HistoryChange,
	type IndexValueRow
} from './index-rent';

// Lease from 2024-01-01 at 600 € + 150 € + 50 €, base index January 2024 = 118,2 (base 2020).
const lease = {
	kind: 'residential' as const,
	rentModel: 'indexed' as const,
	indexBaseMonth: '2024-01',
	indexBaseValue: 118.2,
	indexBaseYear: '2020'
};

function change(overrides: Partial<HistoryChange>): HistoryChange {
	return {
		validFrom: '2024-01-01',
		baseRent: 60000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		reason: 'initial',
		status: 'approved',
		indexMonth: null,
		indexValue: null,
		indexBaseYear: '2020',
		...overrides
	};
}

const initial = change({});

const values: IndexValueRow[] = [
	{ month: '2025-01', value: 121.0, baseYear: '2020' },
	{ month: '2026-01', value: 124.3, baseYear: '2020' }
];

describe('indexProposal', () => {
	it('computes new rent, increase and percentage', () => {
		// 600,00 × 124,3 ÷ 118,2 = 630,9645 → 630,96; +30,96; 124,3 ÷ 118,2 − 1 = 5,1607 %
		expect(
			indexProposal(60000, { month: '2024-01', value: 118.2 }, { month: '2026-01', value: 124.3 })
		).toEqual({
			currentBaseRent: 60000,
			newBaseRent: 63096,
			increase: 3096,
			percent: 5.16,
			reference: { month: '2024-01', value: 118.2 },
			latest: { month: '2026-01', value: 124.3 }
		});
	});

	it('rounds half up', () => {
		// 1,00 € × 100,5 ÷ 100 = 1,005 → 1,01
		const proposal = indexProposal(
			100,
			{ month: '2024-01', value: 100 },
			{ month: '2025-01', value: 100.5 }
		);
		expect(proposal.newBaseRent).toBe(101);
		expect(proposal.percent).toBe(0.5);
	});

	it('reports a fallen index as a negative increase', () => {
		// 600,00 × 117,0 ÷ 118,2 = 593,9086 → 593,91; 117 ÷ 118,2 − 1 = −1,0152 %
		const proposal = indexProposal(
			60000,
			{ month: '2024-01', value: 118.2 },
			{ month: '2025-01', value: 117 }
		);
		expect(proposal.newBaseRent).toBe(59391);
		expect(proposal.increase).toBe(-609);
		expect(proposal.percent).toBe(-1.02);
	});
});

describe('effectiveFrom', () => {
	it('is the first day of the second month after delivery (§ 557b Abs. 3 BGB)', () => {
		expect(effectiveFrom('2026-03-15')).toBe('2026-05-01');
		expect(effectiveFrom('2026-03-01')).toBe('2026-05-01');
		expect(effectiveFrom('2026-11-30')).toBe('2027-01-01');
		expect(effectiveFrom('2026-12-01')).toBe('2027-02-01');
	});
});

describe('referenceIndex', () => {
	it('falls back to the lease base when no change carries an index', () => {
		expect(referenceIndex([initial], lease, '2026-12-01')).toEqual({
			month: '2024-01',
			value: 118.2,
			baseYear: '2020'
		});
		expect(
			referenceIndex(
				[initial],
				{ indexBaseMonth: null, indexBaseValue: null, indexBaseYear: '2020' },
				'2026-12-01'
			)
		).toBe(undefined);
	});

	it('takes the latest approved change with an index and ignores proposals', () => {
		const history = [
			initial,
			change({
				validFrom: '2025-09-01',
				baseRent: 61421,
				reason: 'indexed',
				indexMonth: '2025-07',
				indexValue: 121
			}),
			change({
				validFrom: '2026-12-01',
				baseRent: 63096,
				reason: 'indexed',
				status: 'proposed',
				indexMonth: '2026-01',
				indexValue: 124.3
			})
		];
		expect(referenceIndex(history, lease, '2026-12-01')).toEqual({
			month: '2025-07',
			value: 121,
			baseYear: '2020'
		});
		// A manual change on an indexed lease records the index too and becomes the reference.
		const manual = change({
			validFrom: '2026-03-01',
			baseRent: 62000,
			reason: 'manual',
			indexMonth: '2026-01',
			indexValue: 124.3
		});
		expect(referenceIndex([...history, manual], lease, '2026-12-01')).toEqual({
			month: '2026-01',
			value: 124.3,
			baseYear: '2020'
		});
		// As of a day before the manual change, it is not the reference yet.
		expect(referenceIndex([...history, manual], lease, '2026-02-28')).toEqual({
			month: '2025-07',
			value: 121,
			baseYear: '2020'
		});
	});
});

describe('latestIndex', () => {
	it('picks the newest month', () => {
		expect(latestIndex(values)).toEqual({
			ok: true,
			latest: { month: '2026-01', value: 124.3, baseYear: '2020' }
		});
	});

	it('refuses an empty table', () => {
		expect(latestIndex([])).toEqual({ ok: false, reason: 'none' });
	});
});

describe('waitingPeriodEnd', () => {
	it('is a year after the latest approved change of the base rent, ignoring statements', () => {
		expect(waitingPeriodEnd([])).toBeUndefined();
		expect(waitingPeriodEnd([initial])).toBe('2025-01-01');
		const history = [
			initial,
			// Prepayments only (§ 560): not a rent change.
			change({ validFrom: '2025-03-01', reason: 'statement', operatingCostPrepayment: 17000 }),
			// Same base rent, other prepayments: not a rent change either.
			change({ validFrom: '2025-06-01', reason: 'manual', heatingCostPrepayment: 6000 }),
			change({ validFrom: '2025-09-01', reason: 'indexed', baseRent: 63000 }),
			change({ validFrom: '2026-12-01', reason: 'indexed', baseRent: 65000, status: 'proposed' })
		];
		expect(waitingPeriodEnd(history)).toBe('2026-09-01');
	});
});

describe('nextGraduatedStepAllowed', () => {
	it('is a year after the previous step, the lease start counting as the first', () => {
		expect(nextGraduatedStepAllowed([])).toBeUndefined();
		expect(nextGraduatedStepAllowed([change({ validFrom: '2025-01-01' })])).toBe('2026-01-01');
		const history = [
			change({ validFrom: '2025-01-01' }),
			change({ validFrom: '2026-02-01', reason: 'graduated', baseRent: 62000 }),
			change({ validFrom: '2026-06-01', reason: 'manual', baseRent: 62000 }),
			change({ validFrom: '2028-01-01', reason: 'graduated', baseRent: 64000, status: 'proposed' })
		];
		expect(nextGraduatedStepAllowed(history)).toBe('2027-02-01');
	});
});

describe('indexSituation', () => {
	it('proposes 630,96 € from 600,00 € once the first year is over', () => {
		const situation = indexSituation(lease, [initial], values, '2026-10-20');
		expect(situation.reference).toEqual({ month: '2024-01', value: 118.2, baseYear: '2020' });
		expect(situation.waitingUntil).toBe('2025-01-01');
		expect(situation.provisionalFrom).toBe('2026-12-01');
		expect(situation.pending).toBeUndefined();
		expect(situation.proposal?.newBaseRent).toBe(63096);
		expect(situation.refusal).toBeUndefined();
	});

	it('refuses while the rent has not stayed unchanged for a year', () => {
		// Lease started 2026-01-01: the new rent could take effect 2026-05-01 at the earliest, but
		// the year ends 2027-01-01.
		const young = [change({ validFrom: '2026-01-01' })];
		const situation = indexSituation(lease, young, values, '2026-03-10');
		expect(situation.refusal).toContain('frühestens zum 01.01.2027');
		// Commercial leases have no waiting period.
		expect(
			indexSituation({ ...lease, kind: 'commercial' }, young, values, '2026-03-10').refusal
		).toBeUndefined();
	});

	it('takes rent and reference as of the effective date, not from a later scheduled change', () => {
		// A commercial lease (no waiting period) with a manual change to 650 € scheduled for
		// 2027-01-01, which recorded the VPI of January 2026. A VPI of September 2026 = 125,0 came
		// in since. A proposal made on 2026-10-20 takes effect on 2026-12-01, before that change:
		// 600,00 × 125,0 ÷ 118,2 = 634,52 €, not 600,00 × 125,0 ÷ 124,3.
		const scheduled = change({
			validFrom: '2027-01-01',
			baseRent: 65000,
			reason: 'manual',
			indexMonth: '2026-01',
			indexValue: 124.3
		});
		const situation = indexSituation(
			{ ...lease, kind: 'commercial' },
			[initial, scheduled],
			[...values, { month: '2026-09', value: 125, baseYear: '2020' }],
			'2026-10-20'
		);
		expect(situation.reference).toEqual({ month: '2024-01', value: 118.2, baseYear: '2020' });
		expect(situation.proposal).toMatchObject({ currentBaseRent: 60000, newBaseRent: 63452 });
		expect(situation.refusal).toBeUndefined();
		// Once the change is in effect, both come from it: 650,00 × 125,0 ÷ 124,3 = 653,66 €.
		const later = indexSituation(
			{ ...lease, kind: 'commercial' },
			[initial, scheduled],
			[...values, { month: '2026-09', value: 125, baseYear: '2020' }],
			'2026-11-20'
		);
		expect(later.reference).toEqual({ month: '2026-01', value: 124.3, baseYear: '2020' });
		expect(later.proposal).toMatchObject({ currentBaseRent: 65000, newBaseRent: 65366 });
	});

	it('refuses VPI values of another base year than the reference', () => {
		// The lease's reference is on base 2020; the table only has values on base 2025.
		const situation = indexSituation(
			lease,
			[initial],
			[{ month: '2026-01', value: 104.1, baseYear: '2025' }],
			'2026-10-20'
		);
		expect(situation.proposal).toBeUndefined();
		expect(situation.refusal).toBe(
			'Der Bezugsindex beruht auf dem Basisjahr 2020, die VPI-Werte auf dem Basisjahr 2025. ' +
				'Trage den Bezugsindex im Mietvertrag auf das Basisjahr 2025 umgerechnet ein.'
		);
	});

	it('names the other reasons a proposal is refused', () => {
		const today = '2026-10-20';
		expect(indexSituation({ ...lease, rentModel: 'fixed' }, [initial], values, today).refusal).toBe(
			'Dieser Mietvertrag hat keine Indexmiete.'
		);
		const pending = change({ validFrom: '2026-12-01', status: 'proposed', reason: 'indexed' });
		expect(indexSituation(lease, [initial, pending], values, today).refusal).toContain(
			'schon einen Vorschlag'
		);
		expect(
			indexSituation(
				{ ...lease, indexBaseMonth: null, indexBaseValue: null },
				[initial],
				values,
				today
			).refusal
		).toContain('Bezugsindex');
		expect(indexSituation(lease, [initial], [], today).refusal).toContain('keine Werte');
		expect(
			indexSituation(
				lease,
				[initial],
				[{ month: '2023-12', value: 117.4, baseYear: '2020' }],
				today
			).refusal
		).toContain('nicht neuer als der Bezugsindex (Januar 2024)');
		expect(
			indexSituation(
				lease,
				[initial],
				[{ month: '2025-01', value: 118.2, baseYear: '2020' }],
				today
			).refusal
		).toContain('nicht gestiegen');
	});
});

describe('index rent with an unordered or incomplete history', () => {
	const indexed = (validFrom: string, indexMonth: string, indexValue: number) =>
		change({ validFrom, reason: 'indexed', indexMonth, indexValue });

	it('takes the latest change whatever the order of the history', () => {
		const history = [
			indexed('2026-01-01', '2025-10', 123),
			initial,
			indexed('2025-01-01', '2024-10', 120)
		];
		expect(referenceIndex(history, lease, '2026-12-01')).toMatchObject({ month: '2025-10' });
		const steps = [
			change({ validFrom: '2026-02-01', reason: 'graduated' }),
			change({ validFrom: '2025-01-01' })
		];
		expect(nextGraduatedStepAllowed(steps)).toBe('2027-02-01');
	});

	it('takes a lease that starts after the effective date as of its start', () => {
		const later = change({ validFrom: '2027-03-01' });
		const situation = indexSituation(
			{ ...lease, kind: 'commercial' },
			[later],
			values,
			'2026-10-20'
		);
		expect(situation.provisionalFrom).toBe('2026-12-01');
		expect(situation.proposal).toMatchObject({ currentBaseRent: 60000 });
		expect(situation.refusal).toBeUndefined();
	});

	it('refuses without any rent', () => {
		const situation = indexSituation(lease, [], values, '2026-10-20');
		expect(situation.proposal).toBeUndefined();
		expect(situation.refusal).toBe('Dem Mietvertrag fehlt die aktuelle Miete.');
	});
});

describe('greeting', () => {
	it('addresses the tenants by salutation in the informal register of the letter', () => {
		// The letter says "dein Mietvertrag", so the greeting is "Guten Tag", not "Sehr geehrte".
		expect(greeting([{ salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' }])).toBe(
			'Guten Tag Frau Muster,'
		);
		expect(
			greeting([
				{ salutation: 'Herr', firstName: 'Max', lastName: 'Beispiel' },
				{ salutation: null, firstName: 'Kim', lastName: 'Test' }
			])
		).toBe('Guten Tag Herr Beispiel, Kim Test,');
		expect(greeting([])).toBe('Guten Tag,');
	});
});

describe('letterFigures and indexLetterText', () => {
	const approved = change({
		validFrom: '2026-12-01',
		baseRent: 63096,
		reason: 'indexed',
		indexMonth: '2026-01',
		indexValue: 124.3
	});

	it('takes the old rent and the reference from the history before the change', () => {
		const figures = letterFigures([initial, approved], lease, approved);
		expect(figures).toEqual({
			reference: { month: '2024-01', value: 118.2, baseYear: '2020' },
			latest: { month: '2026-01', value: 124.3 },
			percent: 5.16,
			oldRent: initial,
			newRent: approved,
			validFrom: '2026-12-01',
			baseYear: '2020'
		});
		expect(letterFigures([approved], lease, approved)).toBeUndefined();
		expect(letterFigures([initial], lease, initial)).toBeUndefined();
		// A reference of another base year does not fit the change's index.
		expect(
			letterFigures([initial, approved], { ...lease, indexBaseYear: '2015' }, approved)
		).toBeUndefined();
	});

	it('writes the letter with index, percentage, old and new rent and the date', () => {
		const figures = letterFigures([initial, approved], lease, approved)!;
		const text = indexLetterText({
			unitName: 'Wohnung EG links',
			tenants: [{ salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' }],
			figures
		});
		const paragraphs = text.split('\n\n');
		expect(paragraphs).toHaveLength(4);
		expect(paragraphs[0]).toBe('Guten Tag Frau Muster,');
		expect(paragraphs[1]).toMatch(/^dein Mietvertrag für Wohnung EG links/);
		expect(paragraphs[1]).toContain('Basisjahr 2020 = 100');
		expect(paragraphs[2]).toContain(
			'von 118,2 (Januar 2024) auf 124,3 (Januar 2026) gestiegen, das sind 5,16 %'
		);
		expect(paragraphs[2]).toContain('von 600,00 € um 30,96 € auf 630,96 € im Monat');
		expect(paragraphs[3]).toContain('ab dem 01.12.2026');
		expect(paragraphs[3]).toContain('Gesamtmiete beträgt dann 830,96 €');

		expect(indexLetterRows(figures)).toEqual([
			['Verbraucherpreisindex', '118,2 (Januar 2024)', '124,3 (Januar 2026)'],
			['Kaltmiete', '600,00 €', '630,96 €'],
			['Gesamtmiete', '800,00 €', '830,96 €']
		]);
	});

	it('says "euer Mietvertrag" to two tenants', () => {
		const figures = letterFigures([initial, approved], lease, approved)!;
		const text = indexLetterText({
			unitName: 'Wohnung EG links',
			tenants: [
				{ salutation: 'Frau', firstName: 'Erika', lastName: 'Muster' },
				{ salutation: 'Herr', firstName: 'Max', lastName: 'Muster' }
			],
			figures
		});
		const paragraphs = text.split('\n\n');
		expect(paragraphs[0]).toBe('Guten Tag Frau Muster, Herr Muster,');
		expect(paragraphs[1]).toMatch(/^euer Mietvertrag für Wohnung EG links/);
	});
});

describe('formatting', () => {
	it('shows index values with one decimal and percentages with two', () => {
		expect(formatIndexValue(121)).toBe('121,0');
		expect(formatIndexValue(118.25)).toBe('118,3');
		expect(formatPercent(5)).toBe('5,00 %');
	});
});
