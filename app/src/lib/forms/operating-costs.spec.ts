import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseCategory, parseCircle, parseKey, parseKeyShares } from './operating-costs';

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
