import { describe, expect, it } from 'vitest';
import { parseDamageReport, parseDamageReportUpdate } from './damage-reports';
import { formDataOf } from './fields';

const photo = (type = 'image/jpeg', size = 10) =>
	new File([new Uint8Array(size)], 'foto.jpg', { type });

describe('parseDamageReport', () => {
	it('reads the report with optional fields as null and the photos', () => {
		const result = parseDamageReport(
			formDataOf({ title: ' Tür klemmt ', description: 'Haustür', photos: [photo(), photo()] })
		);
		expect(result).toMatchObject({
			ok: true,
			data: {
				title: 'Tür klemmt',
				description: 'Haustür',
				location: null,
				urgent: false,
				reporterName: null,
				reporterPhone: null
			}
		});
		if (result.ok) expect(result.data.photos).toHaveLength(2);
	});

	it('requires title and description and checks the photos', () => {
		expect(parseDamageReport(formDataOf({}))).toMatchObject({
			ok: false,
			errors: { title: expect.any(String), description: expect.any(String) }
		});
		const base = { title: 'x', description: 'y' };
		expect(
			parseDamageReport(formDataOf({ ...base, photos: [photo('application/pdf')] }))
		).toMatchObject({
			ok: false,
			errors: { photos: 'Bitte nur Fotos anhängen (JPEG, PNG, GIF oder WebP).' }
		});
		expect(
			parseDamageReport(formDataOf({ ...base, photos: [photo('image/png', 6 * 1024 * 1024)] }))
		).toMatchObject({ ok: false, errors: { photos: expect.stringContaining('zu groß') } });
	});
});

describe('parseDamageReportUpdate', () => {
	it('reads a known status and an optional reply', () => {
		expect(parseDamageReportUpdate(formDataOf({ status: 'done', reply: '' }))).toEqual({
			ok: true,
			data: { status: 'done', reply: null }
		});
		expect(parseDamageReportUpdate(formDataOf({ status: 'weg' }))).toMatchObject({ ok: false });
	});
});
