import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import {
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
		allocable: 'on'
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
				receipt: null
			}
		});
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
