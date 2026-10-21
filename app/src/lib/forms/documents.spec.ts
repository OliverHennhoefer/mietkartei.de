import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES } from '../server/documents';
import {
	documentErrorMessage,
	documentName,
	parseDocumentFilter,
	parseDocumentId,
	parseDocumentUpload
} from './documents';
import { formDataOf } from './fields';

const pdf = () => new File(['%PDF-1.4 test'], 'Mietvertrag.pdf', { type: 'application/pdf' });

describe('parseDocumentUpload', () => {
	it('accepts a file with a name and links', () => {
		const file = pdf();
		const result = parseDocumentUpload(
			formDataOf({ file, name: ' Mietvertrag unterschrieben ', propertyId: 'p1', leaseId: 'l1' })
		);
		expect(result).toEqual({
			ok: true,
			data: {
				file,
				name: 'Mietvertrag unterschrieben.pdf',
				propertyId: 'p1',
				leaseId: 'l1',
				tenantId: null
			}
		});
	});

	it('names the document after the file when no name is typed', () => {
		const result = parseDocumentUpload(formDataOf({ file: pdf(), name: '' }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.name).toBe('Mietvertrag.pdf');
		expect(result.data).toMatchObject({ propertyId: null, leaseId: null, tenantId: null });
	});

	it('requires a file and refuses an empty one', () => {
		const missing = parseDocumentUpload(formDataOf({ name: 'x' }));
		expect(missing).toEqual({
			ok: false,
			errors: { file: 'Bitte wähle eine Datei aus.' },
			values: { name: 'x', propertyId: '', leaseId: '', tenantId: '' }
		});

		// What a browser sends when no file is chosen: a file without a name.
		const unchosen = parseDocumentUpload(formDataOf({ file: new File([], '') }));
		expect(unchosen.ok).toBe(false);
		if (unchosen.ok) return;
		expect(unchosen.errors).toEqual({ file: 'Bitte wähle eine Datei aus.' });

		const empty = parseDocumentUpload(formDataOf({ file: new File([], 'leer.txt') }));
		expect(empty.ok).toBe(false);
		if (empty.ok) return;
		expect(empty.errors).toEqual({ file: 'Die Datei ist leer.' });
	});

	it('refuses a file over 10 MB and names the limit', () => {
		const big = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'gross.bin');
		const result = parseDocumentUpload(formDataOf({ file: big }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({ file: 'Die Datei ist zu groß (höchstens 10 MB).' });

		const limit = new File([new Uint8Array(MAX_DOCUMENT_BYTES)], 'genau.bin');
		expect(parseDocumentUpload(formDataOf({ file: limit })).ok).toBe(true);
	});

	it('limits the name and the link ids', () => {
		const result = parseDocumentUpload(
			formDataOf({ file: pdf(), name: 'x'.repeat(201), leaseId: 'y'.repeat(65) })
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			name: 'Höchstens 200 Zeichen.',
			leaseId: 'Ungültige Auswahl.'
		});
	});
});

describe('documentName', () => {
	it('adds the extension of the file unless the typed name already ends with it', () => {
		expect(documentName(null, ' Beleg.pdf ')).toBe('Beleg.pdf');
		expect(documentName('Grundsteuer 2025', 'scan.PDF')).toBe('Grundsteuer 2025.PDF');
		expect(documentName('Grundsteuer 2025.pdf', 'scan.PDF')).toBe('Grundsteuer 2025.pdf');
		expect(documentName('Protokoll v1.2', 'x.txt')).toBe('Protokoll v1.2.txt');
		expect(documentName('Notiz', 'ohne-endung')).toBe('Notiz');
		expect(documentName('Notiz', 'punkt.am.ende.')).toBe('Notiz');
	});

	it('shortens a long name before the extension, so the extension stays', () => {
		const typed = documentName('a'.repeat(200), 'scan.pdf');
		expect(typed).toHaveLength(200);
		expect(typed.endsWith('a.pdf')).toBe(true);
		const fromFile = documentName(null, `${'b'.repeat(250)}.docx`);
		expect(fromFile).toHaveLength(200);
		expect(fromFile.endsWith('b.docx')).toBe(true);
		expect(documentName(null, 'c'.repeat(250))).toHaveLength(200);
	});
});

describe('documentErrorMessage', () => {
	it('has a German sentence for every refusal', () => {
		expect(documentErrorMessage('too-large')).toBe('Die Datei ist zu groß (höchstens 10 MB).');
		expect(documentErrorMessage('empty')).toBe('Die Datei ist leer.');
		expect(documentErrorMessage('unknown-link')).toBe(
			'Die gewählte Verknüpfung gibt es nicht mehr.'
		);
	});
});

describe('parseDocumentFilter', () => {
	it('takes the five link parameters and ignores empty, overlong and unknown ones', () => {
		const params = new URLSearchParams({
			propertyId: ' p1 ',
			unitId: '',
			leaseId: 'l1',
			tenantId: 'x'.repeat(65),
			costItemId: 'c1',
			other: 'ignored'
		});
		expect(parseDocumentFilter(params)).toEqual({
			propertyId: 'p1',
			leaseId: 'l1',
			costItemId: 'c1'
		});
		expect(parseDocumentFilter(new URLSearchParams())).toEqual({});
	});
});

describe('parseDocumentId', () => {
	it('returns the id of a delete form, or undefined when it is missing or malformed', () => {
		expect(parseDocumentId(formDataOf({ documentId: 'd1' }))).toBe('d1');
		expect(parseDocumentId(formDataOf({}))).toBeUndefined();
		expect(parseDocumentId(formDataOf({ documentId: '' }))).toBeUndefined();
		expect(parseDocumentId(formDataOf({ documentId: 'x'.repeat(65) }))).toBeUndefined();
		expect(parseDocumentId(formDataOf({ documentId: pdf() }))).toBeUndefined();
	});
});
