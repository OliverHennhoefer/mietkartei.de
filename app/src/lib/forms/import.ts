import { importFields, importKinds, type ColumnMapping, type ImportKind } from '../server/import';
import { FormParser, type ParseResult } from './fields';

// Parses the form of /import. Step 1 sends the kind and the file; step 2 (preview and commit)
// sends the kind, the file as base64 content and one `map.<field>` select per target field,
// whose value is the column index or '' for "nicht importieren".

export type ImportFormInput = {
	kind: ImportKind;
	/** The uploaded file of step 1, null from step 2 on. */
	file: File | null;
	/** The base64 content of step 2, null in step 1. */
	content: string | null;
	/** Only meaningful with `content`; step 1 gets the proposal instead. */
	mapping: ColumnMapping;
};

/** The hidden field doubles the size of the page, so the file stays small. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export function parseImportForm(form: FormData): ParseResult<ImportFormInput> {
	const parser = new FormParser<ImportFormInput>(form);
	const kind = parser.oneOf('kind', importKinds);
	const file = parser.file('file', { maxBytes: IMPORT_MAX_BYTES });
	const rawContent = form.get('content');
	const content = typeof rawContent === 'string' && rawContent !== '' ? rawContent : null;
	if (!file && !content) parser.fail('file', 'Bitte wähle eine CSV-Datei aus.');

	const mapping: ColumnMapping = {};
	for (const field of kind ? importFields[kind] : []) {
		const value = parser.raw(`map.${field.name}`);
		if (!value) {
			mapping[field.name] = null;
			continue;
		}
		const column = Number(value);
		if (!Number.isInteger(column) || column < 0) {
			parser.fail('mapping', 'Die Spaltenzuordnung ist ungültig.');
			mapping[field.name] = null;
		} else {
			mapping[field.name] = column;
		}
	}

	return parser.result(() => ({ kind: kind!, file, content, mapping }));
}
