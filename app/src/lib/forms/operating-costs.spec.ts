import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import {
	categoryErrorField,
	costItemErrorField,
	keyErrorField,
	parseCategory,
	parseCircle,
	parseCostItem,
	parseKey,
	parseKeyShares,
	parseMeter,
	parseReading,
	parseUnitAmounts
} from './operating-costs';

describe('parseCategory', () => {
	it('parses a category with its defaults', () => {
		const result = parseCategory(
			formDataOf({
				name: ' Hausstrom ',
				betrkvItem: '11',
				allocable: 'on',
				allocationKeyId: 'key-1',
				billingCircleId: '',
				sortOrder: '11'
			})
		);
		expect(result).toEqual({
			ok: true,
			data: {
				name: 'Hausstrom',
				betrkvItem: 11,
				allocable: true,
				consumptionBased: false,
				allocationKeyId: 'key-1',
				billingCircleId: null,
				sortOrder: 11
			}
		});
	});

	it('needs a name and a BetrKV item between 1 and 17', () => {
		const result = parseCategory(formDataOf({ name: '', betrkvItem: '18' }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors)).toEqual(['name', 'betrkvItem']);
	});
});

describe('parseKey', () => {
	it('keeps the meter kind and percent only for the kinds that use them', () => {
		const area = parseKey(
			formDataOf({ name: 'Fläche', kind: 'area', meterKind: 'heat', consumptionPercent: '70' })
		);
		expect(area).toEqual({
			ok: true,
			data: {
				name: 'Fläche',
				kind: 'area',
				propertyId: null,
				meterKind: null,
				consumptionPercent: null
			}
		});
		const mixed = parseKey(
			formDataOf({
				name: 'Heizung 60/40',
				kind: 'mixed',
				meterKind: 'heat',
				consumptionPercent: '60'
			})
		);
		expect(mixed).toEqual({
			ok: true,
			data: {
				name: 'Heizung 60/40',
				kind: 'mixed',
				propertyId: null,
				meterKind: 'heat',
				consumptionPercent: 60
			}
		});
	});

	it('refuses a heat or hot water split outside 50–70 %, but allows it for water', () => {
		const heat = parseKey(
			formDataOf({ name: 'Heizung', kind: 'mixed', meterKind: 'heat', consumptionPercent: '80' })
		);
		expect(heat.ok).toBe(false);
		if (!heat.ok) expect(heat.errors.consumptionPercent).toContain('HeizKV');
		const water = parseKey(
			formDataOf({
				name: 'Wasser',
				kind: 'mixed',
				meterKind: 'cold_water',
				consumptionPercent: '80'
			})
		);
		expect(water.ok).toBe(true);
	});

	it('needs a meter kind for consumption keys and a property for custom keys', () => {
		const consumption = parseKey(formDataOf({ name: 'Strom', kind: 'consumption' }));
		expect(consumption.ok).toBe(false);
		if (!consumption.ok) expect(Object.keys(consumption.errors)).toEqual(['meterKind']);
		const custom = parseKey(formDataOf({ name: 'MEA', kind: 'custom' }));
		expect(custom.ok).toBe(false);
		if (!custom.ok) expect(Object.keys(custom.errors)).toEqual(['propertyId']);
	});
});

describe('parseKeyShares', () => {
	it('reads one share per unit and drops empty and zero ones', () => {
		const result = parseKeyShares(
			formDataOf({ 'share-u1': '125,5', 'share-u2': '', 'share-u3': '0' }),
			['u1', 'u2', 'u3']
		);
		expect(result).toEqual({ ok: true, data: { shares: [{ unitId: 'u1', share: 125.5 }] } });
	});

	it('reports a share that is not a number on its field', () => {
		const result = parseKeyShares(formDataOf({ 'share-u1': 'viel' }), ['u1']);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors)).toEqual(['share-u1']);
	});
});

describe('parseCircle', () => {
	it('needs a name and at least one unit', () => {
		expect(parseCircle(formDataOf({ name: 'Haus A', unitIds: ['u1', 'u2'] }))).toEqual({
			ok: true,
			data: { name: 'Haus A', unitIds: ['u1', 'u2'] }
		});
		const empty = parseCircle(formDataOf({ name: 'Haus A' }));
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.errors.unitIds).toBeDefined();
	});
});

describe('parseMeter', () => {
	it('treats the empty unit as the building', () => {
		expect(
			parseMeter(
				formDataOf({
					unitId: '',
					kind: 'heat',
					serialNumber: 'WMZ-1',
					unit: 'kWh',
					location: 'Keller',
					installedAt: '2024-01-01'
				})
			)
		).toEqual({
			ok: true,
			data: {
				unitId: null,
				kind: 'heat',
				serialNumber: 'WMZ-1',
				unit: 'kWh',
				location: 'Keller',
				installedAt: '2024-01-01'
			}
		});
	});

	it('needs a kind and a unit of measure', () => {
		const result = parseMeter(formDataOf({ kind: 'steam', unit: '' }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors)).toEqual(['kind', 'unit']);
	});
});

describe('parseReading', () => {
	it('parses a German decimal value', () => {
		expect(
			parseReading(
				formDataOf({ readAt: '2025-12-31', value: '1.234,5', estimated: 'on', note: '' })
			)
		).toEqual({
			ok: true,
			data: { readAt: '2025-12-31', value: 1234.5, estimated: true, note: null }
		});
	});

	it('refuses a missing date or value', () => {
		const result = parseReading(formDataOf({ readAt: '', value: '' }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors)).toEqual(['readAt', 'value']);
	});
});

describe('the field a refusal is shown at', () => {
	it('names the select that holds the wrong choice', () => {
		expect(categoryErrorField('unknown-key')).toBe('allocationKeyId');
		expect(categoryErrorField('unknown-circle')).toBe('billingCircleId');
		expect(categoryErrorField('duplicate-name')).toBe('name');
		expect(keyErrorField('property-in-use')).toBe('propertyId');
		expect(keyErrorField('kind-in-use')).toBe('kind');
		expect(keyErrorField('duplicate-name')).toBe('name');
		expect(costItemErrorField('unknown-property')).toBe('propertyId');
		expect(costItemErrorField('unknown-category')).toBe('categoryId');
		expect(costItemErrorField('no-key')).toBe('allocationKeyId');
		expect(costItemErrorField('unknown-circle')).toBe('billingCircleId');
		expect(costItemErrorField('missing')).toBe('description');
	});
});

describe('parseCostItem', () => {
	const fields = {
		propertyId: 'p1',
		categoryId: 'c1',
		allocationKeyId: '',
		billingCircleId: 'default',
		description: 'Grundsteuer 2025',
		supplier: 'Stadt Berlin',
		invoiceDate: '2025-03-01',
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31',
		amount: '1.200,00',
		allocable: 'on',
		fuel: '',
		fuelKwh: '',
		co2Kg: '',
		co2Cost: ''
	};

	it('leaves key and circle to the category when nothing was chosen', () => {
		expect(parseCostItem(formDataOf(fields))).toEqual({
			ok: true,
			data: {
				propertyId: 'p1',
				categoryId: 'c1',
				allocationKeyId: null,
				billingCircleId: null,
				circleFromCategory: true,
				description: 'Grundsteuer 2025',
				supplier: 'Stadt Berlin',
				invoiceDate: '2025-03-01',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 120000,
				allocable: true,
				fuel: null,
				fuelKwh: null,
				co2Kg: null,
				co2Cost: null,
				associationTotal: null,
				associationKey: null,
				associationKeyTotal: null,
				associationKeyShare: null,
				receipt: null
			}
		});
	});

	it('reads the WEG figures, with MEA as the default key', () => {
		const result = parseCostItem(
			formDataOf({
				...fields,
				amount: '357,00',
				associationTotal: '4.200,00',
				associationKey: '',
				associationKeyTotal: '1000',
				associationKeyShare: '85'
			})
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				amount: 35700,
				associationTotal: 420000,
				associationKey: 'MEA',
				associationKeyTotal: 1000,
				associationKeyShare: 85
			});
		}
	});

	it('ignores the key of the WEG without its total', () => {
		// The form fills the key from the MEA of the property; a Grundsteuer has no WEG total.
		const result = parseCostItem(
			formDataOf({
				...fields,
				associationKey: 'MEA',
				associationKeyTotal: '1000',
				associationKeyShare: '85'
			})
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				associationTotal: null,
				associationKey: null,
				associationKeyTotal: null,
				associationKeyShare: null
			});
		}
	});

	it('wants the key with the WEG total, the share at most the key total', () => {
		const missing = parseCostItem(formDataOf({ ...fields, associationTotal: '4200' }));
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(Object.keys(missing.errors).sort()).toEqual([
				'associationKeyShare',
				'associationKeyTotal'
			]);
		}
		const larger = parseCostItem(
			formDataOf({
				...fields,
				associationTotal: '4200',
				associationKeyTotal: '1000',
				associationKeyShare: '1001'
			})
		);
		expect(larger.ok).toBe(false);
		if (!larger.ok) expect(Object.keys(larger.errors)).toEqual(['associationKeyShare']);
	});

	it('reads an explicit key and circle', () => {
		const result = parseCostItem(
			formDataOf({ ...fields, allocationKeyId: 'k1', billingCircleId: 'circle-1' })
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				allocationKeyId: 'k1',
				billingCircleId: 'circle-1',
				circleFromCategory: false
			});
		}
	});

	it('keeps the fuel figures only with a fuel', () => {
		const result = parseCostItem(
			formDataOf({ ...fields, fuel: 'gas', fuelKwh: '25000', co2Kg: '', co2Cost: '300,00' })
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				fuel: 'gas',
				fuelKwh: 25000,
				co2Kg: null,
				co2Cost: 30000
			});
		}
		const noFuel = parseCostItem(formDataOf({ ...fields, fuelKwh: '25000', co2Cost: '300' }));
		expect(noFuel.ok).toBe(true);
		if (noFuel.ok) expect(noFuel.data).toMatchObject({ fuel: null, fuelKwh: null, co2Cost: null });
	});

	it('refuses a circle id that cannot be one', () => {
		const result = parseCostItem(formDataOf({ ...fields, billingCircleId: 'x'.repeat(65) }));
		expect(result).toMatchObject({ ok: false, errors: { billingCircleId: 'Ungültige Auswahl.' } });
	});

	it('reads "Alle Einheiten des Objekts" as no circle and a negative amount as a credit', () => {
		const result = parseCostItem(formDataOf({ ...fields, billingCircleId: '', amount: '-50,00' }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				billingCircleId: null,
				circleFromCategory: false,
				amount: -5000
			});
		}
	});

	it('refuses a period that ends before it starts and a missing amount', () => {
		const result = parseCostItem(
			formDataOf({ ...fields, periodStart: '2025-12-31', periodEnd: '2025-01-01', amount: '' })
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['amount', 'periodEnd']);
	});

	it('takes the receipt file', () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'rechnung.pdf', { type: 'application/pdf' });
		const result = parseCostItem(formDataOf({ ...fields, receipt: file }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.receipt?.name).toBe('rechnung.pdf');
	});
});

describe('parseUnitAmounts', () => {
	it('reads one amount per unit and drops empty and zero ones: 400 + 350', () => {
		const result = parseUnitAmounts(
			formDataOf({ 'amount-u1': '400,00', 'amount-u2': '', 'amount-u3': '0', 'amount-u4': '350' }),
			['u1', 'u2', 'u3', 'u4']
		);
		expect(result).toEqual({
			ok: true,
			data: {
				amounts: [
					{ unitId: 'u1', amount: 40000 },
					{ unitId: 'u4', amount: 35000 }
				]
			}
		});
	});
});
