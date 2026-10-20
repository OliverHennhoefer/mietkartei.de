import { describe, expect, it } from 'vitest';
import {
	asciiFilename,
	canInline,
	contentDisposition,
	describeDocumentLinks,
	documentTypeLabel,
	formatFileSize,
	type DocumentLinkOptions
} from './documents';

describe('formatFileSize', () => {
	it('shows bytes, kilobytes and megabytes with one decimal', () => {
		expect(formatFileSize(0)).toBe('0\u00a0B');
		expect(formatFileSize(1023)).toBe('1023\u00a0B');
		// 1024 / 1024 = 1
		expect(formatFileSize(1024)).toBe('1\u00a0KB');
		// 1536 / 1024 = 1,5
		expect(formatFileSize(1536)).toBe('1,5\u00a0KB');
		// 1.048.575 / 1024 = 1023,999… → one decimal rounds to 1024 KB
		expect(formatFileSize(1_048_575)).toBe('1.024\u00a0KB');
		// 1.048.576 = 1 MB
		expect(formatFileSize(1_048_576)).toBe('1\u00a0MB');
		// 11.010.048 / 1.048.576 = 10,5
		expect(formatFileSize(11_010_048)).toBe('10,5\u00a0MB');
		// 1.234.567 / 1.048.576 = 1,177… → 1,2
		expect(formatFileSize(1_234_567)).toBe('1,2\u00a0MB');
	});
});

describe('documentTypeLabel', () => {
	it('names the common types in German and falls back to Datei', () => {
		expect(documentTypeLabel('application/pdf')).toBe('PDF');
		expect(documentTypeLabel('image/jpeg')).toBe('Bild');
		expect(documentTypeLabel('text/plain; charset=utf-8')).toBe('Text');
		expect(documentTypeLabel('text/csv')).toBe('CSV');
		expect(
			documentTypeLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
		).toBe('Textdokument');
		expect(documentTypeLabel('application/vnd.ms-excel')).toBe('Tabelle');
		expect(documentTypeLabel('application/zip')).toBe('ZIP');
		expect(documentTypeLabel('message/rfc822')).toBe('E-Mail');
		expect(documentTypeLabel('application/octet-stream')).toBe('Datei');
		expect(documentTypeLabel('')).toBe('Datei');
	});
});

describe('canInline', () => {
	it('allows PDFs and raster images only', () => {
		expect(canInline('application/pdf')).toBe(true);
		expect(canInline('image/png')).toBe(true);
		expect(canInline('IMAGE/JPEG')).toBe(true);
		expect(canInline('image/svg+xml')).toBe(false);
		expect(canInline('text/html')).toBe(false);
		expect(canInline('text/plain')).toBe(false);
	});
});

describe('contentDisposition', () => {
	it('transliterates umlauts for the plain name and percent-encodes the real one', () => {
		expect(asciiFilename('Übergabeprotokoll Müller.pdf')).toBe('Uebergabeprotokoll Mueller.pdf');
		expect(asciiFilename('Résumé "quoted" (1)*.txt')).toBe('Resume _quoted_ _1__.txt');
		expect(asciiFilename('   ')).toBe('Dokument');
		expect(contentDisposition('Übergabeprotokoll.pdf')).toBe(
			`attachment; filename="Uebergabeprotokoll.pdf"; filename*=UTF-8''%C3%9Cbergabeprotokoll.pdf`
		);
		expect(contentDisposition("Vertrag (Müller)'s*.pdf", true)).toBe(
			`inline; filename="Vertrag _Mueller__s_.pdf"; filename*=UTF-8''Vertrag%20%28M%C3%BCller%29%27s%2A.pdf`
		);
	});
});

describe('describeDocumentLinks', () => {
	const options: DocumentLinkOptions = {
		properties: [{ id: 'p1', label: 'Lindenstraße 4' }],
		units: [{ id: 'u1', label: 'EG links · Lindenstraße 4', propertyId: 'p1' }],
		leases: [{ id: 'l1', label: 'EG links · Lindenstraße 4 · Erika Mustermann' }],
		tenants: [{ id: 't1', label: 'Erika Mustermann' }],
		costItems: [{ id: 'c1', label: 'Grundsteuer 2025' }]
	};

	it('lists every known link with its page, in a fixed order', () => {
		expect(
			describeDocumentLinks(
				{ propertyId: 'p1', unitId: 'u1', leaseId: 'l1', tenantId: 't1', costItemId: 'c1' },
				options
			)
		).toEqual([
			{ kind: 'propertyId', label: 'Lindenstraße 4', href: '/objekte/p1' },
			{ kind: 'unitId', label: 'EG links · Lindenstraße 4', href: '/objekte/p1/einheiten/u1' },
			{
				kind: 'leaseId',
				label: 'EG links · Lindenstraße 4 · Erika Mustermann',
				href: '/vertraege/l1'
			},
			{ kind: 'tenantId', label: 'Erika Mustermann', href: '/mieter/t1' },
			{ kind: 'costItemId', label: 'Grundsteuer 2025', href: '/betriebskosten/belege/c1' }
		]);
	});

	it('skips null links, unknown ids and omitted kinds', () => {
		expect(
			describeDocumentLinks(
				{ propertyId: null, unitId: 'gone', leaseId: 'l1', tenantId: null, costItemId: null },
				options,
				['leaseId']
			)
		).toEqual([]);
		expect(
			describeDocumentLinks(
				{ propertyId: 'p1', unitId: null, leaseId: 'l1', tenantId: null, costItemId: null },
				options,
				['leaseId']
			)
		).toEqual([{ kind: 'propertyId', label: 'Lindenstraße 4', href: '/objekte/p1' }]);
	});
});
