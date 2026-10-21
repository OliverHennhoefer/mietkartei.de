import { describe, expect, it } from 'vitest';
import type { LeaseInput } from '../server/leases';
import { formDataOf } from './fields';
import {
	depositWarning,
	MAX_LEASE_IDS,
	parseLease,
	parseLeaseEdit,
	parseLeaseEnd,
	parseLeasePersons,
	parseOpeningBalance
} from './leases';

/** A plain residential lease with every optional field left empty. */
const minimal = {
	unitId: 'unit-1',
	tenantIds: ['tenant-1'],
	startDate: '2026-01-01',
	kind: 'residential',
	rentModel: 'fixed',
	operatingCostModel: 'prepayment',
	heatingCostModel: 'prepayment',
	baseRent: '650,00'
};

function parse(overrides: Record<string, string | string[]> = {}) {
	return parseLease(formDataOf({ ...minimal, ...overrides }));
}

function errorsOf(overrides: Record<string, string | string[]>) {
	const result = parse(overrides);
	expect(result.ok).toBe(false);
	return result.ok ? {} : result.errors;
}

describe('parseLease', () => {
	it('parses a complete indexed lease with German decimal amounts', () => {
		const result = parse({
			extraUnitIds: ['parking-1', 'parking-2'],
			tenantIds: ['tenant-1', 'tenant-2'],
			endDate: '2027-12-31',
			kind: 'commercial',
			rentModel: 'indexed',
			operatingCostModel: 'flat',
			heatingCostModel: 'flat',
			baseRent: '1.250,00',
			operatingCostPrepayment: '180,50',
			heatingCostPrepayment: '70',
			securityDeposit: '3.750,00',
			persons: '3',
			rentDueDay: '1',
			ledgerStart: '2026-06-01',
			indexBaseMonth: '2025-12',
			indexBaseValue: '121,4',
			indexBaseYear: '2015',
			terminatedAt: '2027-09-30',
			terminatedBy: 'tenant',
			notes: 'Büro im EG, Stellplätze inklusive.'
		});
		expect(result).toEqual({
			ok: true,
			data: {
				unitId: 'unit-1',
				extraUnitIds: ['parking-1', 'parking-2'],
				tenantIds: ['tenant-1', 'tenant-2'],
				startDate: '2026-01-01',
				endDate: '2027-12-31',
				kind: 'commercial',
				rentModel: 'indexed',
				operatingCostModel: 'flat',
				heatingCostModel: 'flat',
				baseRent: 125000,
				operatingCostPrepayment: 18050,
				heatingCostPrepayment: 7000,
				securityDeposit: 375000,
				persons: 3,
				rentDueDay: 1,
				ledgerStart: '2026-06-01',
				indexBaseMonth: '2025-12',
				indexBaseValue: 121.4,
				indexBaseYear: '2015',
				terminatedAt: '2027-09-30',
				terminatedBy: 'tenant',
				notes: 'Büro im EG, Stellplätze inklusive.'
			}
		});
	});

	it('fills the defaults when the optional fields are empty', () => {
		expect(parse()).toEqual({
			ok: true,
			data: {
				unitId: 'unit-1',
				extraUnitIds: [],
				tenantIds: ['tenant-1'],
				startDate: '2026-01-01',
				endDate: null,
				kind: 'residential',
				rentModel: 'fixed',
				operatingCostModel: 'prepayment',
				heatingCostModel: 'prepayment',
				baseRent: 65000,
				operatingCostPrepayment: 0,
				heatingCostPrepayment: 0,
				securityDeposit: 0,
				persons: 1,
				rentDueDay: 3,
				ledgerStart: null,
				indexBaseMonth: null,
				indexBaseValue: null,
				indexBaseYear: '2020',
				terminatedAt: null,
				terminatedBy: null,
				notes: null
			}
		});
	});

	it('keeps the index base only for an indexed rent', () => {
		const result = parse({ indexBaseMonth: '2025-12', indexBaseValue: '121,4' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.indexBaseMonth).toBeNull();
		expect(result.data.indexBaseValue).toBeNull();
	});

	it('requires a unit, a tenant, a start date, the models and the base rent', () => {
		const result = parseLease(formDataOf({}));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			unitId: 'Bitte wähle einen Eintrag aus.',
			tenantIds: 'Bitte wähle mindestens einen Mieter aus.',
			startDate: 'Bitte gib ein Datum an.',
			kind: 'Bitte wähle einen Eintrag aus.',
			rentModel: 'Bitte wähle einen Eintrag aus.',
			operatingCostModel: 'Bitte wähle einen Eintrag aus.',
			heatingCostModel: 'Bitte wähle einen Eintrag aus.',
			baseRent: 'Bitte gib einen Betrag an.'
		});
	});

	it('rejects unknown models, bad amounts and a malformed date, echoing the values', () => {
		const result = parse({
			kind: 'garage',
			baseRent: 'abc',
			securityDeposit: '-1',
			startDate: '2026-02-30'
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			kind: 'Bitte wähle einen gültigen Eintrag aus.',
			baseRent: 'Bitte gib einen Betrag an, z. B. 650,00.',
			securityDeposit: 'Der Betrag darf nicht unter 0 € liegen.',
			startDate: 'Bitte gib ein gültiges Datum an.'
		});
		expect(result.values.baseRent).toBe('abc');
		expect(result.values.tenantIds).toBe('tenant-1');
	});

	it('takes at most MAX_LEASE_IDS tenants and extra units', () => {
		const ids = Array.from({ length: MAX_LEASE_IDS + 1 }, (_, index) => `id-${index}`);
		expect(errorsOf({ tenantIds: ids, extraUnitIds: ids })).toEqual({
			tenantIds: `Höchstens ${MAX_LEASE_IDS} Einträge.`,
			extraUnitIds: `Höchstens ${MAX_LEASE_IDS} Einträge.`
		});
	});

	it('rejects an end date before the start', () => {
		expect(errorsOf({ endDate: '2025-12-31' })).toEqual({
			endDate: 'Das Vertragsende liegt vor dem Beginn.'
		});
		expect(parse({ endDate: '2026-01-01' }).ok).toBe(true);
	});

	it('refuses a ledger start before the lease begins', () => {
		expect(errorsOf({ ledgerStart: '2025-12-31' })).toEqual({
			ledgerStart: 'Das Mietkonto kann nicht vor dem Vertragsbeginn beginnen.'
		});
		expect(parse({ endDate: '2026-12-31', ledgerStart: '2026-12-31' }).ok).toBe(true);
		// A lease ended before its ledger start stays editable.
		expect(parse({ endDate: '2026-12-31', ledgerStart: '2027-01-01' }).ok).toBe(true);
		expect(parse({ ledgerStart: '2030-01-01' }).ok).toBe(true);
	});

	it('limits persons and the due day to whole numbers in range', () => {
		expect(errorsOf({ persons: '21', rentDueDay: '0' })).toEqual({
			persons: 'Der Wert darf nicht über 20 liegen.',
			rentDueDay: 'Der Wert darf nicht unter 1 liegen.'
		});
		expect(errorsOf({ persons: '1,5', rentDueDay: '21' })).toEqual({
			persons: 'Bitte gib eine ganze Zahl an.',
			rentDueDay: 'Der Wert darf nicht über 20 liegen.'
		});
		const result = parse({ persons: '0', rentDueDay: '20' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.persons).toBe(0);
		expect(result.data.rentDueDay).toBe(20);
	});

	it('needs both the date and the party of a termination', () => {
		expect(errorsOf({ terminatedAt: '2026-09-30' })).toEqual({
			terminatedBy: 'Bitte wähle aus, wer gekündigt hat.'
		});
		expect(errorsOf({ terminatedBy: 'landlord' })).toEqual({
			terminatedAt: 'Bitte gib an, wann gekündigt wurde.'
		});
		expect(errorsOf({ terminatedAt: '2026-09-30', terminatedBy: 'bank' })).toEqual({
			terminatedBy: 'Bitte wähle einen gültigen Eintrag aus.'
		});
	});

	it('needs the index base for an indexed rent, and a positive index value', () => {
		const message = 'Für eine Indexmiete brauchst du den Basismonat und den Indexwert.';
		expect(errorsOf({ rentModel: 'indexed' })).toEqual({
			indexBaseMonth: message,
			indexBaseValue: message
		});
		expect(errorsOf({ rentModel: 'indexed', indexBaseMonth: '2025-12' })).toEqual({
			indexBaseValue: message
		});
		expect(
			errorsOf({ rentModel: 'indexed', indexBaseMonth: '2025-13', indexBaseValue: '0' })
		).toEqual({
			indexBaseMonth: 'Bitte gib einen gültigen Monat an.',
			indexBaseValue: 'Der Indexwert muss größer als 0 sein.'
		});
		expect(
			errorsOf({
				rentModel: 'indexed',
				indexBaseMonth: '2025-12',
				indexBaseValue: '121,4',
				indexBaseYear: '20'
			})
		).toEqual({ indexBaseYear: 'Bitte gib das Basisjahr mit vier Ziffern an, z. B. 2020.' });
	});

	it('limits the notes', () => {
		expect(errorsOf({ notes: 'n'.repeat(2001) })).toEqual({ notes: 'Höchstens 2000 Zeichen.' });
	});
});

describe('depositWarning', () => {
	it('warns when a residential deposit exceeds three base rents', () => {
		expect(depositWarning({ kind: 'residential', baseRent: 65000, securityDeposit: 195001 })).toBe(
			'Die Kaution übersteigt drei Nettokaltmieten (§ 551 BGB).'
		);
	});

	it('allows exactly three base rents', () => {
		expect(
			depositWarning({ kind: 'residential', baseRent: 65000, securityDeposit: 195000 })
		).toBeUndefined();
	});

	it('does not apply to parking and commercial leases', () => {
		expect(
			depositWarning({ kind: 'parking', baseRent: 5000, securityDeposit: 30000 })
		).toBeUndefined();
		expect(
			depositWarning({ kind: 'commercial', baseRent: 125000, securityDeposit: 750000 })
		).toBeUndefined();
	});
});

const current: LeaseInput = {
	unitId: 'unit-1',
	extraUnitIds: ['parking-1'],
	tenantIds: ['tenant-1'],
	startDate: '2025-01-01',
	endDate: null,
	kind: 'residential',
	rentModel: 'fixed',
	operatingCostModel: 'prepayment',
	heatingCostModel: 'prepayment',
	baseRent: 60000,
	operatingCostPrepayment: 15000,
	heatingCostPrepayment: 5000,
	securityDeposit: 180000,
	persons: 2,
	rentDueDay: 3,
	ledgerStart: null,
	indexBaseMonth: null,
	indexBaseValue: null,
	indexBaseYear: '2020',
	terminatedAt: null,
	terminatedBy: null,
	notes: null
};

describe('parseLeaseEdit', () => {
	it('takes the editable fields from the form and the units from the lease', () => {
		const result = parseLeaseEdit(
			formDataOf({
				unitId: 'hacked',
				extraUnitIds: ['hacked'],
				// The amounts, deposit and persons at the start can be corrected here.
				baseRent: '610,00',
				operatingCostPrepayment: '155,00',
				heatingCostPrepayment: '',
				securityDeposit: '1.830,00',
				persons: '3',
				tenantIds: ['tenant-2'],
				startDate: '2025-02-01',
				endDate: '2026-12-31',
				kind: 'commercial',
				rentModel: 'fixed',
				operatingCostModel: 'flat',
				heatingCostModel: 'flat',
				rentDueDay: '1',
				ledgerStart: '2026-01-01',
				notes: 'geändert'
			}),
			current
		);
		expect(result).toEqual({
			ok: true,
			data: {
				...current,
				baseRent: 61000,
				operatingCostPrepayment: 15500,
				heatingCostPrepayment: 0,
				securityDeposit: 183000,
				persons: 3,
				tenantIds: ['tenant-2'],
				startDate: '2025-02-01',
				endDate: '2026-12-31',
				kind: 'commercial',
				operatingCostModel: 'flat',
				heatingCostModel: 'flat',
				rentDueDay: 1,
				ledgerStart: '2026-01-01',
				notes: 'geändert'
			}
		});
	});

	it('validates like the creation form', () => {
		const result = parseLeaseEdit(formDataOf({ tenantIds: ['tenant-1'] }), current);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.startDate).toBe('Bitte gib ein Datum an.');
	});
});

describe('parseOpeningBalance', () => {
	it('accepts a signed amount and nothing at all', () => {
		expect(parseOpeningBalance(formDataOf({ openingBalance: '-120,00' }))).toEqual({
			ok: true,
			data: { openingBalance: -12000 }
		});
		expect(parseOpeningBalance(formDataOf({}))).toEqual({
			ok: true,
			data: { openingBalance: null }
		});
		const bad = parseOpeningBalance(formDataOf({ openingBalance: 'viel' }));
		expect(bad.ok).toBe(false);
	});
});

describe('parseLeasePersons', () => {
	it('parses a row and checks the range', () => {
		expect(parseLeasePersons(formDataOf({ validFrom: '2026-03-01', persons: '3' }))).toEqual({
			ok: true,
			data: { validFrom: '2026-03-01', persons: 3, note: null }
		});
		const bad = parseLeasePersons(formDataOf({ persons: '21' }));
		expect(bad.ok).toBe(false);
		if (bad.ok) return;
		expect(bad.errors).toEqual({
			validFrom: 'Bitte gib ein Datum an.',
			persons: 'Der Wert darf nicht über 20 liegen.'
		});
	});
});

describe('parseLeaseEnd', () => {
	it('parses the notice and refuses an end before it', () => {
		expect(
			parseLeaseEnd(
				formDataOf({ terminatedAt: '2026-03-02', terminatedBy: 'landlord', endDate: '2026-05-31' })
			)
		).toEqual({
			ok: true,
			data: {
				terminatedAt: '2026-03-02',
				terminatedBy: 'landlord',
				endDate: '2026-05-31',
				earlyEndAgreed: false
			}
		});
		expect(
			parseLeaseEnd(
				formDataOf({
					terminatedAt: '2026-03-02',
					terminatedBy: 'tenant',
					endDate: '2026-03-31',
					earlyEndAgreed: 'on'
				})
			)
		).toMatchObject({ ok: true, data: { earlyEndAgreed: true } });
		const bad = parseLeaseEnd(
			formDataOf({ terminatedAt: '2026-03-02', terminatedBy: 'tenant', endDate: '2026-03-01' })
		);
		expect(bad.ok).toBe(false);
		if (bad.ok) return;
		expect(bad.errors).toEqual({
			endDate: 'Das Vertragsende liegt vor dem Eingang der Kündigung.'
		});
	});
});
