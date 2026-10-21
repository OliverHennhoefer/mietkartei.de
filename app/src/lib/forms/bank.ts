import { matchingFieldIds, type ColumnMapping } from '../domain/bank-matching';
import { formatCents } from '../money';
import type { MatchingField } from '../server/db/schema';
import { FormParser, type FieldErrors, type ParseResult } from './fields';

// Parsers of the banking forms: bank accounts, the two-step CSV import, the inline assignment of
// a transaction and the matching rules. Ids are checked against the account by the server module.

export type BankAccountInput = {
	name: string;
	iban: string;
	bic: string | null;
	holder: string;
};

export function parseBankAccount(form: FormData): ParseResult<BankAccountInput> {
	const parser = new FormParser<BankAccountInput>(form);
	const name = parser.text('name', { max: 100 });
	const iban = parser.iban('iban');
	const bic = parser.optionalText('bic', 11)?.toUpperCase() ?? null;
	if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
		parser.fail('bic', 'Bitte gib eine gültige BIC an (8 oder 11 Zeichen).');
	}
	const holder = parser.text('holder', { max: 100 });
	return parser.result(() => ({ name, iban: iban!, bic, holder }));
}

/** The columns the user maps for a file without a preset; raw column names, '' = none. */
export type MappingFields = {
	bookingDate: string;
	valueDate: string;
	amount: string;
	counterpartName: string;
	counterpartIban: string;
	purpose: string;
};

export const mappingFieldNames = [
	'bookingDate',
	'valueDate',
	'amount',
	'counterpartName',
	'counterpartIban',
	'purpose'
] as const;

export type ImportInput = {
	bankAccountId: string;
	/** Step 1: the uploaded file. */
	file: File | null;
	/** Step 2: the file's bytes, base64, carried in a hidden field. */
	content: string | null;
	fileName: string;
	/** A preset id, or `generic` for the user's own column mapping. '' until the file was read. */
	preset: string;
	mapping: MappingFields;
};

const MAX_CSV_BYTES = 2 * 1024 * 1024;

export function parseImport(form: FormData): ParseResult<ImportInput> {
	const parser = new FormParser<ImportInput>(form);
	const bankAccountId = parser.id('bankAccountId');
	const content = parser.optionalText('content', 4 * MAX_CSV_BYTES);
	const file = parser.file('file', { required: !content, maxBytes: MAX_CSV_BYTES });
	const fileName = parser.optionalText('fileName') ?? file?.name ?? 'kontoauszug.csv';
	const preset = parser.optionalText('preset', 40) ?? '';
	const mapping = {} as MappingFields;
	for (const field of mappingFieldNames) mapping[field] = parser.raw(field).slice(0, 200);
	return parser.result(() => ({
		bankAccountId: bankAccountId!,
		file,
		content,
		fileName,
		preset,
		mapping
	}));
}

/**
 * Why a generic mapping cannot be applied yet, as the sentence the preview shows; undefined when
 * the date and the amount column are chosen. The import step decides, not the parser, because the
 * first upload of a generic file has no mapping yet and still needs its preview.
 */
export function mappingError(mapping: MappingFields): string | undefined {
	if (!mapping.bookingDate) return 'Bitte wähle die Spalte mit dem Buchungstag.';
	if (!mapping.amount) return 'Bitte wähle die Spalte mit dem Betrag.';
	return undefined;
}

/** The user's selects → the mapping the domain applies; an empty select means "no such column". */
export function toColumnMapping(mapping: MappingFields): ColumnMapping {
	return {
		bookingDate: mapping.bookingDate,
		valueDate: mapping.valueDate || null,
		amount: mapping.amount,
		counterpartName: mapping.counterpartName || null,
		counterpartIban: mapping.counterpartIban || null,
		purpose: mapping.purpose || null
	};
}

export const assignmentTargets = ['rent', 'deposit'] as const;
export type AssignmentTarget = (typeof assignmentTargets)[number];

export type AssignmentInput = {
	target: AssignmentTarget;
	/** The lease(s) and signed amounts; they sum to the transaction's amount. */
	parts: { leaseId: string; amount: number }[];
	/** "Zuordnung merken": create a confirmed rule for the counterpart. */
	remember: boolean;
};

/** Form fields of the inline assignment; the error keys the page shows. */
export type AssignmentFields = {
	leaseId: string;
	target: string;
	splitLeaseId: string;
	amount: string;
	splitAmount: string;
	remember: string;
};

/**
 * Parses the inline form of one open transaction. Amounts are typed as positive numbers; the
 * sign of the transaction is applied. Without a second lease the whole amount goes to the lease.
 */
export type AssignmentResult =
	| { ok: true; data: AssignmentInput }
	| { ok: false; errors: FieldErrors<AssignmentFields>; values: Record<string, string> };

export function parseAssignment(form: FormData, transactionAmount: number): AssignmentResult {
	const parser = new FormParser<AssignmentFields>(form);
	const leaseId = parser.id('leaseId');
	const target = parser.oneOf('target', assignmentTargets);
	const splitLeaseId = parser.id('splitLeaseId', { required: false });
	const remember = parser.flag('remember');
	const sign = transactionAmount < 0 ? -1 : 1;
	const total = Math.abs(transactionAmount);

	let parts: { leaseId: string; amount: number }[] = [{ leaseId: leaseId ?? '', amount: total }];
	if (splitLeaseId) {
		const amount = parser.money('amount', { min: 1 });
		const splitAmount = parser.money('splitAmount', { min: 1 });
		if (splitLeaseId === leaseId) {
			parser.fail('splitLeaseId', 'Bitte wähle einen anderen Mietvertrag für den zweiten Teil.');
		}
		if (target === 'deposit') {
			parser.fail(
				'splitLeaseId',
				'Eine Kaution kann nicht auf zwei Mietverträge aufgeteilt werden.'
			);
		}
		if (remember) {
			parser.fail('remember', 'Eine aufgeteilte Zuordnung kann nicht gemerkt werden.');
		}
		if (amount !== null && splitAmount !== null && amount + splitAmount !== total) {
			parser.fail(
				'splitAmount',
				`Die beiden Beträge müssen zusammen ${formatCents(total)} ergeben.`
			);
		}
		parts = [
			{ leaseId: leaseId ?? '', amount: amount ?? 0 },
			{ leaseId: splitLeaseId, amount: splitAmount ?? 0 }
		];
	} else {
		// The amount fields only matter for a split; keep what was typed for the re-render.
		parser.raw('amount');
		parser.raw('splitAmount');
	}

	if (parser.hasErrors) return { ok: false, errors: parser.errors, values: parser.values };
	return {
		ok: true,
		data: {
			target: target!,
			parts: parts.map((part) => ({ leaseId: part.leaseId, amount: sign * part.amount })),
			remember
		}
	};
}

export type RuleInput = {
	leaseId: string;
	field: MatchingField;
	pattern: string;
	/** Confirmed rules assign on import; unconfirmed ones only suggest. */
	confirmed: boolean;
};

export function parseRule(form: FormData): ParseResult<RuleInput> {
	const parser = new FormParser<RuleInput>(form);
	const leaseId = parser.id('leaseId');
	const field = parser.oneOf('field', matchingFieldIds);
	const pattern = parser.text('pattern', { max: 200 });
	if (pattern && pattern.length < 2) parser.fail('pattern', 'Mindestens zwei Zeichen.');
	const confirmed = parser.flag('confirmed');
	return parser.result(() => ({ leaseId: leaseId!, field: field!, pattern, confirmed }));
}
