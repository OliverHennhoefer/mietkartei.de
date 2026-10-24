import { fail } from '@sveltejs/kit';
import {
	base64ToBytes,
	bytesToBase64,
	GENERIC_PRESET_ID,
	proposeGenericMapping,
	type ColumnMapping
} from '#lib/domain/bank-matching.ts';
import { parseBankUpload, restrictToAccount, type ParsedUpload } from '#lib/domain/camt.ts';
import {
	MAX_IMPORT_ROWS,
	mappingError,
	parseImport,
	toColumnMapping,
	type ImportInput
} from '#lib/forms/bank.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import type { Database } from '#lib/server/db/index.ts';
import { getBankAccount, listBankAccounts } from '#lib/server/bank/accounts.ts';
import { commitImport, previewImport, type PreviewRow } from '#lib/server/bank/imports.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Two steps without client JavaScript: "Datei prüfen" reads the upload and answers with the
// preview, whose form carries the file base64-encoded in a hidden field together with the
// mapping; "Importieren" reads that field again and commits. A file without a known header gets
// the column selects first and a preview once the date and the amount column are chosen. A camt
// file (or a ZIP of them) needs no mapping; its lines for another account than the chosen one
// are shown as invalid and left out.

/** How many rows of a large file the preview table shows; the counts cover every row. */
const PREVIEW_ROWS = 500;

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	return { bankAccounts: await listBankAccounts(locals.db, accountId) };
};

type ReadFile = { bytes: Uint8Array; content: string };

/** The uploaded file in step one, the hidden field in step two. */
async function readFile(input: ImportInput): Promise<ReadFile | undefined> {
	if (input.file) {
		const bytes = new Uint8Array(await input.file.arrayBuffer());
		return { bytes, content: bytesToBase64(bytes) };
	}
	if (input.content) {
		try {
			return { bytes: base64ToBytes(input.content), content: input.content };
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export type Preview = {
	bankAccountId: string;
	fileName: string;
	content: string;
	/** The preset id, or `generic` when the columns are mapped by hand. */
	preset: string;
	presetName: string | null;
	columns: string[];
	mapping: ImportInput['mapping'];
	/** Why the generic mapping is not complete yet; the rows are empty then. */
	mappingError: string | null;
	rows: PreviewRow[];
	/** How many rows the table left out. */
	hiddenRows: number;
	counts: { total: number; new: number; duplicates: number; rules: number; invalid: number };
};

const emptyCounts = { total: 0, new: 0, duplicates: 0, rules: 0, invalid: 0 };

/** The rows of the upload, restricted to the chosen bank account; the reason when unreadable. */
async function readRows(
	db: Database,
	accountId: string,
	bankAccountId: string,
	bytes: Uint8Array,
	generic: ColumnMapping | null
): Promise<ParsedUpload> {
	const parsed = parseBankUpload(bytes, generic);
	if (!parsed.ok || !parsed.accountIbans) return parsed;
	const account = await getBankAccount(db, accountId, bankAccountId);
	if (!account) return { ok: false, reason: 'Diese Bankverbindung gibt es nicht.' };
	const results = restrictToAccount(parsed.file.results, parsed.accountIbans, account.iban);
	return { ...parsed, file: { ...parsed.file, results } };
}

const TOO_MANY_ROWS = `Eine Datei darf höchstens ${MAX_IMPORT_ROWS.toLocaleString('de-DE')} Zeilen haben. Bitte teile den Zeitraum auf.`;

function failed(message: string, values: Record<string, string>) {
	const errors: FieldErrors<ImportInput> = { file: message };
	return fail(400, { errors, values });
}

export const actions: Actions = {
	preview: async ({ request, locals }) => {
		const accountId = requireAccount(locals);
		const result = parseImport(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const input = result.data;
		const file = await readFile(input);
		if (!file) return failed('Bitte wähle eine Datei aus.', {});

		let generic: ColumnMapping | null =
			input.preset === GENERIC_PRESET_ID && !mappingError(input.mapping)
				? toColumnMapping(input.mapping)
				: null;
		let upload = await readRows(locals.db, accountId, input.bankAccountId, file.bytes, generic);
		if (!upload.ok) return failed(upload.reason, {});
		// The first look at a file without a known format proposes the columns from their names;
		// when that finds the date and the amount, the preview follows right away.
		if (!upload.file.preset && input.preset === '') {
			input.mapping = proposeGenericMapping(upload.file.columns);
			if (!mappingError(input.mapping)) {
				generic = toColumnMapping(input.mapping);
				upload = await readRows(locals.db, accountId, input.bankAccountId, file.bytes, generic);
				if (!upload.ok) return failed(upload.reason, {});
			}
		}
		const parsed = upload.file;
		if (parsed.results.length > MAX_IMPORT_ROWS) return failed(TOO_MANY_ROWS, {});

		const preview: Preview = {
			bankAccountId: input.bankAccountId,
			fileName: input.fileName,
			content: file.content,
			preset: parsed.preset?.id ?? GENERIC_PRESET_ID,
			presetName: parsed.preset?.name ?? null,
			columns: parsed.columns,
			mapping: input.mapping,
			mappingError: parsed.preset ? null : (mappingError(input.mapping) ?? null),
			rows: [],
			hiddenRows: 0,
			counts: emptyCounts
		};
		if (!parsed.preset && (!generic || preview.mappingError)) return { preview };

		const analysed = await previewImport(locals.db, accountId, input.bankAccountId, parsed.results);
		if (!analysed) return failed('Diese Bankverbindung gibt es nicht.', {});
		preview.rows = analysed.rows.slice(0, PREVIEW_ROWS);
		preview.hiddenRows = Math.max(0, analysed.rows.length - PREVIEW_ROWS);
		preview.counts = analysed.counts;
		return { preview };
	},

	commit: async ({ request, locals }) => {
		const result = parseImport(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const input = result.data;
		const file = await readFile(input);
		if (!file || input.file) return failed('Bitte prüfe die Datei zuerst.', {});

		const generic = input.preset === GENERIC_PRESET_ID ? toColumnMapping(input.mapping) : null;
		if (generic) {
			const message = mappingError(input.mapping);
			if (message) return failed(message, {});
		}
		const context = auditContext(locals);
		const upload = await readRows(
			locals.db,
			context.accountId,
			input.bankAccountId,
			file.bytes,
			generic
		);
		if (!upload.ok) return failed(upload.reason, {});
		const parsed = upload.file;
		if (parsed.results.length > MAX_IMPORT_ROWS) return failed(TOO_MANY_ROWS, {});
		if (!parsed.preset && !generic) return failed('Bitte ordne die Spalten zu.', {});

		const imported = await commitImport(
			locals.db,
			context,
			input.bankAccountId,
			input.fileName,
			parsed.results
		);
		if (!imported) return failed('Diese Bankverbindung gibt es nicht.', {});
		return { result: imported };
	}
};
