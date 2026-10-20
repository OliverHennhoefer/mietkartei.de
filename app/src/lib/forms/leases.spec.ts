import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { depositWarning, parseLease } from './leases';

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

	it('rejects an end date before the start', () => {
		expect(errorsOf({ endDate: '2025-12-31' })).toEqual({
			endDate: 'Das Vertragsende liegt vor dem Beginn.'
		});
		expect(parse({ endDate: '2026-01-01' }).ok).toBe(true);
	});

	it('keeps the ledger start within the lease term', () => {
		const message = 'Der Beginn des Mietkontos liegt außerhalb der Vertragslaufzeit.';
		expect(errorsOf({ ledgerStart: '2025-12-31' })).toEqual({ ledgerStart: message });
		expect(errorsOf({ endDate: '2026-12-31', ledgerStart: '2027-01-01' })).toEqual({
			ledgerStart: message
		});
		expect(parse({ endDate: '2026-12-31', ledgerStart: '2026-12-31' }).ok).toBe(true);
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
