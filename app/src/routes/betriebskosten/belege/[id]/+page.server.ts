import { error, fail, redirect } from '@sveltejs/kit';
import { yearOf } from '#lib/domain/operating-costs.ts';
import { documentErrorMessage } from '#lib/forms/documents.ts';
import { costItemMessages, parseReceipt, parseUnitAmounts } from '#lib/forms/operating-costs.ts';
import { deleteDocument, type DocumentError } from '#lib/server/documents.ts';
import {
	costItemHistory,
	deleteCostItem,
	ensureDefaults,
	getCircle,
	getCostItem,
	listCategories,
	listCircles,
	listKeys,
	listUnitAmounts,
	replaceUnitAmounts,
	updateCostItem
} from '#lib/server/operating-costs.ts';
import { listProperties, listUnits } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import { costItemFailure, itemPage, parseCostItemForm, storeReceipt } from '../save.server';
import type { Actions, PageServerLoad } from './$types';

async function itemOf(locals: App.Locals, costItemId: string) {
	const item = await getCostItem(locals.db, requireAccount(locals), costItemId);
	if (!item) error(404, costItemMessages.missing);
	return item;
}

/** The units a direct key splits over: those of the item's circle, else all of the property. */
async function splitUnits(
	locals: App.Locals,
	item: { propertyId: string; billingCircleId: string | null }
) {
	const accountId = requireAccount(locals);
	const units = await listUnits(locals.db, accountId, item.propertyId);
	if (!item.billingCircleId) return units;
	const circle = await getCircle(locals.db, accountId, item.billingCircleId);
	if (!circle) return units;
	return units.filter((unit) => circle.unitIds.includes(unit.id));
}

const documentErrors: DocumentError[] = ['too-large', 'empty', 'unknown-link', 'quota'];

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const accountId = requireAccount(locals);
	await ensureDefaults(locals.db, accountId);
	const item = await itemOf(locals, params.id);
	const [properties, categories, keys, circles, history] = await Promise.all([
		listProperties(locals.db, accountId),
		listCategories(locals.db, accountId),
		listKeys(locals.db, accountId),
		listCircles(locals.db, accountId),
		costItemHistory(locals.db, accountId)
	]);
	const direct = item.keyKind === 'direct';
	const units = direct ? await splitUnits(locals, item) : [];
	const unitAmounts = direct ? await listUnitAmounts(locals.db, accountId, item.id) : [];
	// Set by a save whose receipt file was refused (see itemPage).
	const receiptError = documentErrors.find(
		(reason) => reason === url.searchParams.get('receiptError')
	);
	return {
		item,
		properties,
		categories,
		keys,
		circles,
		history,
		units,
		unitAmounts,
		receiptError: receiptError && documentErrorMessage(receiptError)
	};
};

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const accountId = requireAccount(locals);
		await itemOf(locals, params.id);
		const parsed = await parseCostItemForm(locals.db, accountId, await request.formData());
		if (!parsed.ok) return fail(400, { form: 'item' as const, ...parsed.failure });
		const { input, receipt, values } = parsed.parsed;
		const context = auditContext(locals);
		const updated = await updateCostItem(locals.db, context, params.id, input);
		if (!updated.ok) {
			if (updated.reason === 'missing') error(404, costItemMessages.missing);
			return fail(400, { form: 'item' as const, ...costItemFailure(updated.reason, values) });
		}
		const receiptError = receipt
			? await storeReceipt(locals.db, context, params.id, input.propertyId, receipt)
			: undefined;
		redirect(303, itemPage(params.id, receiptError));
	},
	amounts: async ({ request, locals, params }) => {
		const item = await itemOf(locals, params.id);
		if (item.keyKind !== 'direct') {
			return fail(400, {
				form: 'amounts' as const,
				refused: 'Beträge je Einheit gibt es nur bei einem Schlüssel „Beträge je Einheit“.'
			});
		}
		const units = await splitUnits(locals, item);
		const result = parseUnitAmounts(
			await request.formData(),
			units.map((unit) => unit.id)
		);
		if (!result.ok) {
			return fail(400, {
				form: 'amounts' as const,
				amountErrors: result.errors,
				amountValues: result.values
			});
		}
		const outcome = await replaceUnitAmounts(
			locals.db,
			auditContext(locals),
			item.id,
			result.data.amounts
		);
		if (outcome !== 'updated') {
			return fail(400, {
				form: 'amounts' as const,
				refused: 'Die Beträge konnten nicht gespeichert werden.'
			});
		}
		return { form: 'amounts' as const, saved: true };
	},
	upload: async ({ request, locals, params }) => {
		const item = await itemOf(locals, params.id);
		const result = parseReceipt(await request.formData());
		if (!result.ok) return fail(400, { form: 'upload' as const, errors: result.errors });
		const receiptError = await storeReceipt(
			locals.db,
			auditContext(locals),
			item.id,
			item.propertyId,
			result.data.receipt
		);
		if (receiptError) {
			return fail(400, {
				form: 'upload' as const,
				errors: { receipt: documentErrorMessage(receiptError) }
			});
		}
		redirect(303, itemPage(item.id));
	},
	deleteReceipt: async ({ request, locals, params }) => {
		const item = await itemOf(locals, params.id);
		const documentId = (await request.formData()).get('documentId');
		const receipt = item.receipts.find((candidate) => candidate.id === documentId);
		if (!receipt || !(await deleteDocument(locals.db, auditContext(locals), receipt.id))) {
			error(404, 'Diese Datei gibt es nicht.');
		}
		redirect(303, itemPage(item.id));
	},
	delete: async ({ locals, params }) => {
		const item = await itemOf(locals, params.id);
		await deleteCostItem(locals.db, auditContext(locals), item.id);
		const query = new URLSearchParams({
			property: item.propertyId,
			year: String(yearOf(item.periodStart))
		});
		redirect(303, `/betriebskosten/belege?${query}`);
	}
};
