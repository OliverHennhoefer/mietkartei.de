import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { FIRST_CO2_YEAR, numberInput, parseCo2Split, prefillCo2Kg } from './co2';

// The reference scenario of PROTOTYPE.md: 25.000 kWh gas, 5.025 kg CO₂, 300 € CO₂ cost, 72,5 m².
const complete = {
	year: '2025',
	fuel: 'gas',
	fuelKwh: '25.000',
	co2Kg: '5.025',
	co2Cost: '300,00',
	area: '72,5',
	invoiceDate: '2026-02-10',
	claimedOn: '2026-03-15'
};

const currentDate = '2026-10-20';

function parse(overrides: Record<string, string> = {}) {
	return parseCo2Split(formDataOf({ ...complete, ...overrides }), currentDate);
}

function failed(overrides: Record<string, string>) {
	const result = parse(overrides);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected a failure');
	return result;
}

describe('prefillCo2Kg', () => {
	it('multiplies the kWh with the emission factor, rounded to one decimal', () => {
		// 25.000 kWh × 0,201 kg/kWh = 5.025 kg
		expect(prefillCo2Kg('gas', 25000)).toBe(5025);
		// 10.000 kWh × 0,266 = 2.660 kg; 1.234 kWh × 0,234 = 288,756 → 288,8 kg
		expect(prefillCo2Kg('oil', 10000)).toBe(2660);
		expect(prefillCo2Kg('lpg', 1234)).toBe(288.8);
	});

	it('has no factor for district heating and other fuels', () => {
		expect(prefillCo2Kg('district_heating', 25000)).toBeUndefined();
		expect(prefillCo2Kg('other', 25000)).toBeUndefined();
	});
});

describe('numberInput', () => {
	it('writes a number the way the form fields expect it', () => {
		expect(numberInput(5025)).toBe('5025');
		expect(numberInput(72.5)).toBe('72,5');
		expect(numberInput(288.756)).toBe('288,76');
	});
});

describe('parseCo2Split', () => {
	it('parses a complete form with German numbers', () => {
		const result = parse();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toEqual({
			year: 2025,
			fuel: 'gas',
			fuelKwh: 25000,
			co2Kg: 5025,
			co2Cost: 30000,
			area: 72.5,
			invoiceDate: '2026-02-10',
			claimedOn: '2026-03-15'
		});
	});

	it('prefills the kg from the kWh and asks for confirmation instead of saving', () => {
		const result = failed({ co2Kg: '' });
		expect(result.errors).toEqual({});
		expect(result.hint).toBe(
			'Aus 25.000 kWh Erdgas ergeben sich 5.025 kg CO₂. Prüfe den Wert gegen die Rechnung und speichere dann.'
		);
		expect(result.values.co2Kg).toBe('5025');
		// The other values are kept for the re-rendered form.
		expect(result.values.co2Cost).toBe('300,00');
	});

	it('requires the kg when the fuel has no factor or the kWh are missing', () => {
		expect(failed({ co2Kg: '', fuel: 'district_heating' }).errors.co2Kg).toBe(
			'Bitte gib die CO₂-Menge an, die auf der Rechnung steht.'
		);
		const withoutKwh = failed({ co2Kg: '', fuelKwh: '' });
		expect(withoutKwh.errors.co2Kg).toBeDefined();
		expect(withoutKwh.hint).toBeNull();
	});

	it('treats the kWh as optional', () => {
		const result = parse({ fuelKwh: '' });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.fuelKwh).toBeNull();
	});

	it('rejects zero amounts, areas and emissions', () => {
		expect(failed({ co2Kg: '0' }).errors.co2Kg).toBe('Die CO₂-Menge muss größer als 0 sein.');
		expect(failed({ co2Cost: '0' }).errors.co2Cost).toBe(
			'Die CO₂-Kosten müssen größer als 0 sein.'
		);
		expect(failed({ area: '0' }).errors.area).toBe('Die Wohnfläche muss größer als 0 sein.');
		expect(failed({ area: '' }).errors.area).toBe('Bitte gib eine Zahl an.');
	});

	it('accepts only years the law applies to, up to the current year', () => {
		expect(failed({ year: '2022' }).errors.year).toBe(
			`Das CO2KostAufG gilt erst ab ${FIRST_CO2_YEAR}.`
		);
		expect(failed({ year: '2027' }).errors.year).toBe('Das Jahr liegt in der Zukunft.');
		expect(failed({ year: '2025,5' }).errors.year).toBe('Bitte gib eine ganze Zahl an.');
		expect(parse({ year: '2026' }).ok).toBe(true);
	});

	it('rejects an unknown fuel', () => {
		expect(failed({ fuel: 'coal' }).errors.fuel).toBe('Bitte wähle einen gültigen Eintrag aus.');
	});

	it('requires the claim date and keeps it after the invoice date', () => {
		expect(failed({ claimedOn: '' }).errors.claimedOn).toBe('Bitte gib ein Datum an.');
		expect(failed({ claimedOn: '2026-02-09' }).errors.claimedOn).toBe(
			'Die Geltendmachung liegt vor dem Rechnungsdatum.'
		);
		const withoutInvoiceDate = parse({ invoiceDate: '' });
		expect(withoutInvoiceDate.ok).toBe(true);
		if (withoutInvoiceDate.ok) expect(withoutInvoiceDate.data.invoiceDate).toBeNull();
	});
});
