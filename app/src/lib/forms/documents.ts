import {
	MAX_DOCUMENT_BYTES,
	MAX_DOCUMENT_NAME,
	type DocumentError,
	type DocumentFilter
} from '../server/documents';
import { FormParser, type ParseResult } from './fields';

// Parses the upload form of /dokumente and the lease's Dokumente tab, the filter of the list
// and the id a delete button sends. The limit is the one the server module enforces.

export type DocumentUploadInput = {
	file: File;
	/** The name shown in lists and used as the file name of the download. */
	name: string;
	propertyId: string | null;
	leaseId: string | null;
	tenantId: string | null;
};

const MAX_MEGABYTES = Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024);

export function parseDocumentUpload(form: FormData): ParseResult<DocumentUploadInput> {
	const parser = new FormParser<DocumentUploadInput>(form);
	const chosen = form.get('file');
	let file: File | null = null;
	if (chosen instanceof File && chosen.name && chosen.size === 0) {
		// A chosen file without content; fields.file() would call it "not chosen".
		parser.fail('file', 'Die Datei ist leer.');
	} else {
		file = parser.file('file', { required: true, maxBytes: MAX_DOCUMENT_BYTES });
	}
	const name = documentName(parser.optionalText('name', MAX_DOCUMENT_NAME), file?.name ?? '');
	const propertyId = parser.id('propertyId', { required: false });
	const leaseId = parser.id('leaseId', { required: false });
	const tenantId = parser.id('tenantId', { required: false });
	return parser.result(() => ({ file: file as File, name, propertyId, leaseId, tenantId }));
}

/**
 * The typed name, or the file name when none was typed. A typed name without the file's
 * extension gets it, so the download keeps opening with the right program. A name longer
 * than MAX_DOCUMENT_NAME is shortened before its extension, which stays.
 */
export function documentName(typed: string | null, fileName: string): string {
	const file = fileName.trim();
	let name = typed ?? file;
	let extension = /\.[A-Za-z0-9]{1,8}$/.exec(file)?.[0] ?? '';
	if (extension && name.toLowerCase().endsWith(extension.toLowerCase())) {
		// Keep the extension as it is written in the name.
		extension = name.slice(-extension.length);
		name = name.slice(0, -extension.length);
	}
	return `${name.slice(0, MAX_DOCUMENT_NAME - extension.length).trimEnd()}${extension}`;
}

const errorMessages: Record<DocumentError, string> = {
	'too-large': `Die Datei ist zu groß (höchstens ${MAX_MEGABYTES} MB).`,
	empty: 'Die Datei ist leer.',
	'unknown-link': 'Die gewählte Verknüpfung gibt es nicht mehr.'
};

/** The German sentence for a refusal of storeDocument. */
export function documentErrorMessage(reason: DocumentError): string {
	return errorMessages[reason];
}

const filterKeys = ['propertyId', 'unitId', 'leaseId', 'tenantId'] as const;

/** The filter of /dokumente from its query parameters; empty or overlong values are ignored. */
export function parseDocumentFilter(params: URLSearchParams): DocumentFilter {
	const filter: DocumentFilter = {};
	for (const key of filterKeys) {
		const value = params.get(key)?.trim();
		if (value && value.length <= 64) filter[key] = value;
	}
	return filter;
}

/** The `documentId` a delete button sends, or undefined when it is missing or malformed. */
export function parseDocumentId(form: FormData): string | undefined {
	const value = form.get('documentId');
	return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : undefined;
}
