import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseApproval, parseGraduatedStep, parseManualChange } from './rent';

// 600 € until a Staffel step to 650 € on 2026-12-01.
const baseRentOn = (validFrom: string) => (validFrom >= '2026-12-01' ? 65000 : 60000);
const restricted = { baseRentOn, noteRequiredOnBaseRentChange: true };
const free = { baseRentOn, noteRequiredOnBaseRentChange: false };

const change = {
	validFrom: '2027-01-01',
	baseRent: '650,00',
	operatingCostPrepayment: '150',
	heatingCostPrepayment: '50,00',
	reason: 'manual'
};

describe('parseManualChange', () => {
	it('parses amounts in cents and an empty note as null', () => {
		expect(parseManualChange(formDataOf(change), free)).toEqual({
			ok: true,
			data: {
				validFrom: '2027-01-01',
				baseRent: 65000,
				operatingCostPrepayment: 15000,
				heatingCostPrepayment: 5000,
				reason: 'manual',
				note: null
			}
		});
	});

	it('requires a note when the base rent of a restricted lease changes', () => {
		const result = parseManualChange(
			formDataOf({ ...change, validFrom: '2026-11-01' }),
			restricted
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.note).toContain('§ 557a Abs. 2 / § 557b Abs. 2 BGB');
			expect(result.values.baseRent).toBe('650,00');
		}
		expect(
			parseManualChange(
				formDataOf({ ...change, validFrom: '2026-11-01', note: 'Einvernehmlich vereinbart.' }),
				restricted
			).ok
		).toBe(true);
		// Only the prepayments change: no reason needed.
		expect(
			parseManualChange(
				formDataOf({ ...change, validFrom: '2026-11-01', baseRent: '600' }),
				restricted
			).ok
		).toBe(true);
	});

	it('compares the base rent with the one valid on the change date, not today', () => {
		// From 2027-01-01 the Staffel step's 650 € apply, so 650 € is no change of the Kaltmiete...
		expect(parseManualChange(formDataOf(change), restricted).ok).toBe(true);
		// ...while 600 € would undo the step and needs a reason.
		const undo = parseManualChange(formDataOf({ ...change, baseRent: '600,00' }), restricted);
		expect(undo.ok).toBe(false);
		if (!undo.ok) expect(undo.errors.note).toContain('§ 557a Abs. 2 / § 557b Abs. 2 BGB');
	});

	it('refuses a missing date, a bad amount and an unknown reason', () => {
		const result = parseManualChange(
			formDataOf({ validFrom: '', baseRent: 'abc', reason: 'indexed' }),
			free
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(Object.keys(result.errors).sort()).toEqual(['baseRent', 'reason', 'validFrom']);
		}
	});
});

describe('parseGraduatedStep', () => {
	it('parses the date and the new base rent', () => {
		expect(parseGraduatedStep(formDataOf({ validFrom: '2026-01-01', baseRent: '620' }))).toEqual({
			ok: true,
			data: { validFrom: '2026-01-01', baseRent: 62000 }
		});
		expect(parseGraduatedStep(formDataOf({ validFrom: '2026-02-30', baseRent: '' })).ok).toBe(
			false
		);
	});
});

describe('parseApproval', () => {
	it('ignores the effective date unless the lease may choose it', () => {
		const form = formDataOf({ deliveredOn: '2026-10-15', validFrom: '2026-11-01' });
		expect(parseApproval(form, { editableValidFrom: false })).toEqual({
			ok: true,
			data: { deliveredOn: '2026-10-15', validFrom: null }
		});
		expect(parseApproval(form, { editableValidFrom: true })).toEqual({
			ok: true,
			data: { deliveredOn: '2026-10-15', validFrom: '2026-11-01' }
		});
	});

	it('refuses an effective date on or before the delivery', () => {
		const result = parseApproval(
			formDataOf({ deliveredOn: '2026-10-15', validFrom: '2026-10-15' }),
			{
				editableValidFrom: true
			}
		);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.errors.validFrom).toBe('Die neue Miete kann erst nach der Zustellung gelten.');
	});
});
