import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { parseDamageReport, parseMeterReport } from './tenant-portal';

const photo = (size = 4, name = 'a.jpg') =>
	new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('parseMeterReport', () => {
	it('reads a German decimal and an optional photo', async () => {
		const result = await parseMeterReport(
			formDataOf({
				meterId: 'm1',
				readAt: '2026-11-26',
				value: '1.234,5',
				note: '',
				photo: photo()
			})
		);
		expect(result).toMatchObject({
			ok: true,
			data: { meterId: 'm1', readAt: '2026-11-26', value: 1234.5, note: null }
		});
		if (result.ok) expect(result.data.photo?.bytes).toHaveLength(4);
		expect(
			await parseMeterReport(formDataOf({ meterId: 'm1', readAt: '2026-11-26', value: '17.25' }))
		).toMatchObject({ ok: true, data: { value: 17.25, photo: null } });
	});

	it('names what is missing or wrong, addressing the tenant', async () => {
		const result = await parseMeterReport(
			formDataOf({ meterId: '', readAt: '26.11.2026', value: 'viel', note: 'x'.repeat(501) })
		);
		expect(result).toEqual({
			ok: false,
			errors: {
				meterId: 'Bitte wählen Sie den Zähler.',
				readAt: 'Bitte geben Sie das Datum der Ablesung an.',
				value: 'Bitte geben Sie den Zählerstand als Zahl an, z. B. 1234,5.',
				note: 'Höchstens 500 Zeichen.'
			},
			values: { meterId: '', readAt: '26.11.2026', value: 'viel', note: 'x'.repeat(501) }
		});
		const large = await parseMeterReport(
			formDataOf({
				meterId: 'm1',
				readAt: '2026-11-26',
				value: '1',
				photo: photo(10 * 1024 * 1024 + 1)
			})
		);
		expect(large).toMatchObject({
			ok: false,
			errors: { photo: expect.stringContaining('zu groß') }
		});
	});
});

describe('parseDamageReport', () => {
	const fields = {
		title: 'Fenster klemmt',
		description: 'Das Fenster im Schlafzimmer lässt sich nicht mehr schließen.',
		reporter: 'Lena Vogt',
		phone: ''
	};

	it('takes up to three photos and leaves out empty file fields', async () => {
		const form = formDataOf(fields);
		form.append('photos', photo());
		form.append('photos', new File([], ''));
		expect(await parseDamageReport(form)).toMatchObject({
			ok: true,
			data: { title: 'Fenster klemmt', phone: null, photos: [{ name: 'a.jpg' }] }
		});
	});

	it('refuses missing text, long text and too many photos', async () => {
		expect(
			await parseDamageReport(formDataOf({ title: '', description: '', reporter: '', phone: '' }))
		).toMatchObject({
			ok: false,
			errors: {
				title: expect.any(String),
				description: expect.any(String),
				reporter: expect.any(String)
			}
		});
		expect(
			await parseDamageReport(
				formDataOf({
					title: 'x'.repeat(101),
					description: 'x'.repeat(2001),
					reporter: 'x'.repeat(101),
					phone: '1'.repeat(41)
				})
			)
		).toMatchObject({
			ok: false,
			errors: {
				title: 'Höchstens 100 Zeichen.',
				description: 'Höchstens 2000 Zeichen.',
				reporter: 'Höchstens 100 Zeichen.',
				phone: 'Höchstens 40 Zeichen.'
			}
		});
		const form = formDataOf(fields);
		for (let index = 0; index < 4; index++) form.append('photos', photo());
		expect(await parseDamageReport(form)).toMatchObject({
			ok: false,
			errors: { photos: 'Bitte wählen Sie höchstens 3 Fotos.' }
		});
		const large = formDataOf(fields);
		large.append('photos', photo(10 * 1024 * 1024 + 1));
		expect(await parseDamageReport(large)).toMatchObject({
			ok: false,
			errors: { photos: expect.stringContaining('zu groß') }
		});
	});
});
