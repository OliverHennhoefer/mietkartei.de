import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseApproval, parseDelivered, parseNewStatement } from './statements';

describe('parseNewStatement', () => {
	const form = (periodStart: string, periodEnd: string) =>
		formDataOf({ propertyId: 'property-1', periodStart, periodEnd });

	it('accepts a calendar year and a twelve-month period across two years', () => {
		expect(parseNewStatement(form('2025-01-01', '2025-12-31'))).toEqual({
			ok: true,
			data: { propertyId: 'property-1', periodStart: '2025-01-01', periodEnd: '2025-12-31' }
		});
		expect(parseNewStatement(form('2025-07-01', '2026-06-30')).ok).toBe(true);
	});

	it('refuses a period over twelve months, one that cuts a month, and a reversed one', () => {
		const error = (start: string, end: string) => {
			const result = parseNewStatement(form(start, end));
			if (result.ok) throw new Error('expected a failure');
			return result.errors.periodEnd;
		};
		expect(error('2025-01-01', '2026-01-31')).toBe(
			'Der Abrechnungszeitraum darf höchstens 12 Monate umfassen (§ 556 Abs. 3 BGB).'
		);
		expect(error('2025-01-15', '2026-01-14')).toBe(
			'Der Abrechnungszeitraum muss am Ersten eines Monats beginnen und am Letzten eines Monats enden.'
		);
		expect(error('2025-12-31', '2025-01-01')).toBe('Das Ende des Zeitraums liegt vor dem Beginn.');
	});

	it('needs a property and both dates', () => {
		const result = parseNewStatement(formDataOf({ periodStart: '2025-01-01' }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.errors).sort()).toEqual(['periodEnd', 'propertyId']);
	});
});

describe('parseApproval', () => {
	it('approves without the late checkbox and without a note', () => {
		expect(parseApproval(formDataOf({}))).toEqual({
			ok: true,
			data: { lateApprovalJustified: false, note: null }
		});
	});

	it('needs a note when the delay is declared not the landlord’s fault', () => {
		const missing = parseApproval(formDataOf({ lateApprovalJustified: 'on', note: '  ' }));
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(missing.errors.note).toBe(
			'Bitte begründe, warum du die Verspätung nicht zu vertreten hast.'
		);
		expect(
			parseApproval(
				formDataOf({ lateApprovalJustified: 'on', note: 'Grundsteuerbescheid kam im Januar' })
			)
		).toEqual({
			ok: true,
			data: { lateApprovalJustified: true, note: 'Grundsteuerbescheid kam im Januar' }
		});
	});
});

describe('parseDelivered', () => {
	it('needs the lease and a valid date', () => {
		expect(parseDelivered(formDataOf({ leaseId: 'lease-1', deliveredOn: '2026-03-15' }))).toEqual({
			ok: true,
			data: { leaseId: 'lease-1', deliveredOn: '2026-03-15' }
		});
		const missing = parseDelivered(formDataOf({ leaseId: 'lease-1', deliveredOn: '' }));
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(Object.keys(missing.errors)).toEqual(['deliveredOn']);
		expect(parseDelivered(formDataOf({ leaseId: 'lease-1', deliveredOn: '2026-02-30' })).ok).toBe(
			false
		);
	});
});
