import { applyCategoryDefaults } from '#lib/domain/operating-costs.ts';
import { documentName } from '#lib/forms/documents.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	costItemErrorField,
	costItemMessages,
	formValues,
	parseCostItem,
	type CostItemForm
} from '#lib/forms/operating-costs.ts';
import type { AuditContext } from '#lib/server/audit.ts';
import type { Database } from '#lib/server/db/index.ts';
import { storeDocument, type DocumentError } from '#lib/server/documents.ts';
import { getCategory, type CostItemInput } from '#lib/server/operating-costs.ts';

// What the create and the edit page share: parsing the one form, filling in the category's
// defaults, and storing the receipt file next to the saved item.

export type CostItemFailure = { errors: FieldErrors<CostItemForm>; values: Record<string, string> };

export type ParsedCostItem = {
	input: CostItemInput;
	receipt: File | null;
	values: Record<string, string>;
};

/** The payload of fail(400, …) for a refusal of the server module, on the field it concerns. */
export function costItemFailure(
	reason: keyof typeof costItemMessages,
	values: Record<string, string>
): CostItemFailure {
	const errors: FieldErrors<CostItemForm> = {};
	errors[costItemErrorField(reason)] = costItemMessages[reason];
	return { errors, values };
}

/** Parses the form and resolves "Standard der Kostenart" against the chosen category. */
export async function parseCostItemForm(
	db: Database,
	accountId: string,
	form: FormData
): Promise<{ ok: true; parsed: ParsedCostItem } | { ok: false; failure: CostItemFailure }> {
	const result = parseCostItem(form);
	if (!result.ok) return { ok: false, failure: { errors: result.errors, values: result.values } };
	const values = formValues(form);
	const category = await getCategory(db, accountId, result.data.categoryId);
	if (!category) return { ok: false, failure: costItemFailure('unknown-category', values) };
	const resolved = applyCategoryDefaults(result.data, category);
	if (!resolved) return { ok: false, failure: costItemFailure('no-key', values) };
	const input: CostItemInput = {
		propertyId: resolved.propertyId,
		categoryId: resolved.categoryId,
		allocationKeyId: resolved.allocationKeyId,
		billingCircleId: resolved.billingCircleId,
		description: resolved.description,
		supplier: resolved.supplier,
		invoiceDate: resolved.invoiceDate,
		periodStart: resolved.periodStart,
		periodEnd: resolved.periodEnd,
		amount: resolved.amount,
		allocable: resolved.allocable,
		fuel: resolved.fuel,
		fuelKwh: resolved.fuelKwh,
		co2Kg: resolved.co2Kg,
		co2Cost: resolved.co2Cost
	};
	return { ok: true, parsed: { input, receipt: resolved.receipt, values } };
}

/**
 * Stores the receipt as a document of the item and its property, with the checks of every
 * upload (size, type, quota). Returns why it was refused, or undefined when it was stored.
 */
export async function storeReceipt(
	db: Database,
	context: AuditContext,
	costItemId: string,
	propertyId: string,
	receipt: File
): Promise<DocumentError | undefined> {
	const stored = await storeDocument(db, context, {
		name: documentName(null, receipt.name),
		mimeType: receipt.type,
		bytes: new Uint8Array(await receipt.arrayBuffer()),
		links: { costItemId, propertyId }
	});
	return stored.ok ? undefined : stored.reason;
}

/**
 * The item's page after saving. A refused receipt is named in the query: the item itself is
 * saved, so the form must not come back to be sent again.
 */
export function itemPage(costItemId: string, receiptError?: DocumentError): string {
	const path = `/betriebskosten/belege/${costItemId}`;
	return receiptError ? `${path}?receiptError=${receiptError}` : path;
}
