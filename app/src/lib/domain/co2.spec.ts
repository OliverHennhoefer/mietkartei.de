import { describe, expect, it } from 'vitest';
import { behgCost, behgHint, co2KgFromKwh, landlordSharePercent, splitCo2Cost } from './co2';

describe('landlordSharePercent', () => {
	it('follows the tiers of Anlage 1 CO2KostAufG for residential buildings', () => {
		expect(landlordSharePercent(0, 'residential')).toBe(0);
		expect(landlordSharePercent(11.99, 'residential')).toBe(0);
		expect(landlordSharePercent(12, 'residential')).toBe(10);
		expect(landlordSharePercent(16.99, 'residential')).toBe(10);
		expect(landlordSharePercent(17, 'residential')).toBe(20);
		expect(landlordSharePercent(22, 'residential')).toBe(30);
		expect(landlordSharePercent(27, 'residential')).toBe(40);
		expect(landlordSharePercent(32, 'residential')).toBe(50);
		expect(landlordSharePercent(37, 'residential')).toBe(60);
		expect(landlordSharePercent(42, 'residential')).toBe(70);
		expect(landlordSharePercent(47, 'residential')).toBe(80);
		expect(landlordSharePercent(52, 'residential')).toBe(95);
		expect(landlordSharePercent(80, 'residential')).toBe(95);
	});

	it('splits half and half for non-residential buildings', () => {
		expect(landlordSharePercent(5, 'non_residential')).toBe(50);
		expect(landlordSharePercent(60, 'non_residential')).toBe(50);
	});
});

describe('splitCo2Cost', () => {
	it('computes the landlord share from the emissions per square metre', () => {
		// 5.025 kg over 184,5 m² = 27,24 kg/m² → tier 27–<32 → 40 % of 300,00 € = 120,00 €.
		expect(splitCo2Cost({ co2Kg: 5025, co2Cost: 30000, area: 184.5, use: 'residential' })).toEqual({
			kgPerSquareMetre: 5025 / 184.5,
			landlordPercent: 40,
			landlordAmount: 12000,
			tenantAmount: 18000
		});
	});

	it('rounds the landlord amount half-up and keeps the sum', () => {
		// 1.005 kg over 72,5 m² = 13,86 kg/m² → 10 % of 123,45 € = 12,345 € → 12,35 €.
		const split = splitCo2Cost({ co2Kg: 1005, co2Cost: 12345, area: 72.5, use: 'residential' });
		expect(split.landlordPercent).toBe(10);
		expect(split.landlordAmount).toBe(1235);
		expect(split.tenantAmount).toBe(11110);
	});

	it('treats a missing area as zero emissions per square metre', () => {
		const split = splitCo2Cost({ co2Kg: 5000, co2Cost: 30000, area: 0, use: 'residential' });
		expect(split).toMatchObject({ kgPerSquareMetre: 0, landlordPercent: 0, landlordAmount: 0 });
	});
});

describe('co2KgFromKwh', () => {
	it('multiplies the kWh with the factor of the fuel: 25.000 kWh gas × 0,201 = 5.025 kg', () => {
		expect(co2KgFromKwh('gas', 25000)).toBe(5025);
		// 10.000 kWh oil × 0,266 = 2.660 kg; 1.234 kWh LPG × 0,234 = 288,756 → 288,8 kg
		expect(co2KgFromKwh('oil', 10000)).toBe(2660);
		expect(co2KgFromKwh('lpg', 1234)).toBe(288.8);
	});

	it('has no figure for fuels without a factor or without kWh', () => {
		expect(co2KgFromKwh('district_heating', 25000)).toBeNull();
		expect(co2KgFromKwh('other', 25000)).toBeNull();
		expect(co2KgFromKwh(null, 25000)).toBeNull();
		expect(co2KgFromKwh('gas', null)).toBeNull();
	});
});

describe('behgCost and behgHint', () => {
	it('prices the emissions at the fixed BEHG price of the year, without VAT', () => {
		expect(behgCost(2025, 5025)).toEqual({ minPrice: 55, maxPrice: 55, min: 27638, max: 27638 });
		expect(behgCost(2023, 1000)?.min).toBe(3000);
		expect(behgHint(2024, 5025)).toBe(
			'CO₂-Preis 2024 nach BEHG: 45 € je Tonne, für 5.025 kg also 226,13\u00a0€ ohne Umsatzsteuer.'
		);
	});

	it('gives the corridor of the 2026 auctions as a range', () => {
		expect(behgCost(2026, 2000)).toEqual({ minPrice: 55, maxPrice: 65, min: 11000, max: 13000 });
		expect(behgHint(2026, 2000)).toContain('55 bis 65 € je Tonne (Versteigerung)');
	});

	it('has nothing for a year without a price or without emissions', () => {
		expect(behgCost(2020, 1000)).toBeNull();
		expect(behgCost(2027, 1000)).toBeNull();
		expect(behgCost(2025, 0)).toBeNull();
		expect(behgHint(2025, Number.NaN)).toBeNull();
	});
});
