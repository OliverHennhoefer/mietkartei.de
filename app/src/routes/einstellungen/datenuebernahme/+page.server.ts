import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { today } from '#lib/dates.ts';
import { parseToolFile } from '#lib/domain/statement-tool.ts';
import { decodeCsv, parseCsv } from '#lib/csv.ts';
import { isXlsx, readXlsx, rowsToCsv, XlsxError } from '#lib/xlsx.ts';
import {
	IMPORT_MAX_BYTES,
	IMPORT_MAX_ROWS,
	parseImportForm,
	type ImportFormInput
} from '#lib/forms/import.ts';
import {
	commitImport,
	decodeContent,
	encodeContent,
	importFields,
	importKindLabels,
	importKinds,
	loadImportContext,
	planImport,
	plannedCount,
	proposeMapping,
	unmappedRequiredFields,
	type ColumnMapping,
	type ImportKind,
	type ImportPlan,
	type ImportSummary,
	type RowResult
} from '#lib/server/import.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { importToolState } from '#lib/server/statement-tool-import.ts';
import type { Actions, PageServerLoad } from './$types';

// The data import in two steps: step 1 uploads the file, step 2 shows the column mapping and a
// preview of the rows and commits. The file travels as a hidden base64 field, so no server-side
// state is needed; the preview and the commit validate the rows with the same code (planImport).

/** A file of the free statement tool is a few kB; anything far larger is no such file. */
const TOOL_FILE_MAX_BYTES = 1_000_000;

/** How many rows the preview shows. */
const PREVIEW_ROWS = 20;

export type ImportPreview = {
	step: 'preview';
	kind: ImportKind;
	content: string;
	headers: string[];
	mapping: ColumnMapping;
	/** The first rows with their validation result. */
	rows: RowResult[];
	/** How many data rows the file has, and how many of them the commit would create. */
	total: number;
	planned: number;
	/** Why the commit was refused, when it was. */
	message?: string;
};

export type ImportDone = { step: 'done'; summary: ImportSummary };

export const load: PageServerLoad = async ({ locals }) => {
	requireAccount(locals);
	// The page cannot import the server module, so it gets the field lists from here.
	const fields = Object.fromEntries(
		importKinds.map((kind) => [
			kind,
			importFields[kind].map(({ name, label, required, hint }) => ({ name, label, required, hint }))
		])
	) as Record<ImportKind, { name: string; label: string; required: boolean; hint?: string }[]>;
	return { kinds: importKinds, kindLabels: importKindLabels, fields };
};

type FormFailure = ActionFailure<{
	errors: Record<string, string>;
	values: Record<string, string>;
}>;

type Prepared = {
	input: ImportFormInput;
	content: string;
	headers: string[];
	mapping: ColumnMapping;
	plan: ImportPlan;
};

function failForm(errors: Record<string, string>, values: Record<string, string>): FormFailure {
	return fail(400, { errors, values });
}

/** Parses the form and the file and plans the import, or fails with the form's errors. */
async function prepare(locals: App.Locals, form: FormData): Promise<Prepared | FormFailure> {
	const parsed = parseImportForm(form);
	if (!parsed.ok) return failForm(parsed.errors as Record<string, string>, parsed.values);
	const input = parsed.data;

	let text: string | undefined;
	if (input.file) {
		const bytes = new Uint8Array(await input.file.arrayBuffer());
		if (isXlsx(bytes)) {
			// An Excel file becomes CSV text here, so step 2 and the commit read it like a CSV file.
			try {
				text = rowsToCsv(readXlsx(bytes));
			} catch (error) {
				if (!(error instanceof XlsxError)) throw error;
				return failForm(
					{
						file: 'Die Excel-Datei konnte nicht gelesen werden. Speichere sie als .xlsx oder als CSV-Datei und versuche es erneut.'
					},
					{ kind: input.kind }
				);
			}
		} else {
			text = decodeCsv(bytes);
		}
	} else if (input.content) text = decodeContent(input.content);
	if (text === undefined) {
		return failForm({ file: 'Die Datei konnte nicht gelesen werden.' }, { kind: input.kind });
	}
	// Step 2 sends the text back; an Excel file can unpack to more than the form takes there.
	if (input.file && encodeContent(text).length > 4 * IMPORT_MAX_BYTES) {
		return failForm(
			{ file: 'Die Tabelle ist zu groß. Bitte teile sie auf mehrere Dateien auf.' },
			{ kind: input.kind }
		);
	}
	const rows = parseCsv(text);
	if (rows.length < 2) {
		return failForm(
			{ file: 'Die Datei enthält keine Datenzeilen unter der Überschrift.' },
			{ kind: input.kind }
		);
	}
	if (rows.length > IMPORT_MAX_ROWS + 1) {
		return failForm(
			{
				file: `Eine Datei darf höchstens ${IMPORT_MAX_ROWS.toLocaleString('de-DE')} Zeilen haben. Bitte teile sie auf.`
			},
			{ kind: input.kind }
		);
	}

	const proposal = proposeMapping(input.kind, rows);
	// Step 1 takes the proposal; step 2 takes the selects as they were sent.
	const mapping = input.file ? proposal.mapping : input.mapping;
	const context = await loadImportContext(locals.db, requireAccount(locals), input.kind);
	const plan = planImport(input.kind, rows, proposal.headerIndex, mapping, context);
	return {
		input,
		content: input.content ?? encodeContent(text),
		headers: proposal.headers,
		mapping,
		plan
	};
}

function isFailure(value: Prepared | FormFailure): value is FormFailure {
	return 'status' in value;
}

function preview(prepared: Prepared, message?: string): ImportPreview {
	return {
		step: 'preview',
		kind: prepared.input.kind,
		content: prepared.content,
		headers: prepared.headers,
		mapping: prepared.mapping,
		rows: prepared.plan.rows.slice(0, PREVIEW_ROWS),
		total: prepared.plan.rows.length,
		planned: plannedCount(prepared.plan),
		message
	};
}

/** The sentence the commit is refused with while a required field has no column. */
function refusal(kind: ImportKind, mapping: ColumnMapping): string | undefined {
	const missing = unmappedRequiredFields(kind, mapping);
	if (missing.length === 0) return undefined;
	const fields = missing.map((label) => `„${label}“`).join(', ');
	const what = importKindLabels[kind];
	return missing.length === 1
		? `Das Pflichtfeld ${fields} ist keiner Spalte zugeordnet; ordne es zu oder prüfe, ob die Datei ${what} enthält.`
		: `Die Pflichtfelder ${fields} sind keiner Spalte zugeordnet; ordne sie zu oder prüfe, ob die Datei ${what} enthält.`;
}

export const actions: Actions = {
	preview: async ({ request, locals }) => {
		const prepared = await prepare(locals, await request.formData());
		if (isFailure(prepared)) return prepared;
		return preview(prepared, refusal(prepared.input.kind, prepared.mapping));
	},

	commit: async ({ request, locals }) => {
		const prepared = await prepare(locals, await request.formData());
		if (isFailure(prepared)) return prepared;
		const message = refusal(prepared.input.kind, prepared.mapping);
		if (message) return fail(400, preview(prepared, message));
		if (plannedCount(prepared.plan) === 0) {
			return fail(
				400,
				preview(prepared, 'Keine Zeile der Datei ist gültig; es wurde nichts importiert.')
			);
		}
		const summary = await commitImport(locals.db, auditContext(locals), prepared.plan);
		const done: ImportDone = { step: 'done', summary };
		return done;
	},

	// A file saved by the free statement tool on mietkartei.de: the house, its tenants and the
	// bills of one period, with a statement draft to open right away.
	tool: async ({ request, locals }) => {
		requireAccount(locals);
		const file = (await request.formData()).get('toolFile');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { toolError: 'Bitte wähle die gespeicherte Datei aus dem Rechner aus.' });
		}
		if (file.size > TOOL_FILE_MAX_BYTES) {
			return fail(400, { toolError: 'Diese Datei ist zu groß für eine Datei aus dem Rechner.' });
		}
		const state = parseToolFile(await file.text(), today());
		if (!state) {
			return fail(400, {
				toolError:
					'Diese Datei ist keine gespeicherte Abrechnung aus dem Rechner auf mietkartei.de. Dort speicherst du sie mit „Als Datei speichern“.'
			});
		}
		const result = await importToolState(locals.db, auditContext(locals), state);
		if (!result.ok) return fail(400, { toolError: result.message });
		redirect(303, `/betriebskosten/abrechnungen/${result.statementId}`);
	}
};
