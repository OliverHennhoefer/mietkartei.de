import { describe, expect, it } from 'vitest';
import { formDataOf } from '#lib/forms/fields.ts';
import { MAX_ACCOUNT_DOCUMENT_BYTES } from '#lib/server/documents.ts';
import { costCategories, documents } from '#lib/server/db/schema.ts';
import {
	createCostItem,
	ensureDefaults,
	listCategories,
	listKeys
} from '#lib/server/operating-costs.ts';
import { contextA, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { itemPage, parseCostItemForm, storeReceipt } from './save.server';

const fields = {
	categoryId: '',
	allocationKeyId: '',
	billingCircleId: 'default',
	description: 'Hausreinigung 2025',
	periodStart: '2025-01-01',
	periodEnd: '2025-12-31',
	amount: '480,00',
	allocable: 'on'
};

describe('parseCostItemForm', () => {
	it("fills in the category's key and refuses a category without one", async () => {
		const db = await testDatabase();
		await ensureDefaults(db, 'a');
		const { propertyId } = await seedUnit(db, 'a');
		const category = (await listCategories(db, 'a')).find(
			(row) => row.name === 'Gebäudereinigung und Ungezieferbekämpfung'
		)!;
		const parsed = await parseCostItemForm(
			db,
			'a',
			formDataOf({ ...fields, propertyId, categoryId: category.id })
		);
		expect(parsed.ok && parsed.parsed.input).toMatchObject({
			allocationKeyId: category.allocationKeyId,
			billingCircleId: null,
			amount: 48000
		});

		const [keyless] = await db
			.insert(costCategories)
			.values({ accountId: 'a', name: 'Ohne Schlüssel' })
			.returning({ id: costCategories.id });
		const refused = await parseCostItemForm(
			db,
			'a',
			formDataOf({ ...fields, propertyId, categoryId: keyless.id })
		);
		expect(refused).toEqual({
			ok: false,
			failure: {
				errors: {
					allocationKeyId:
						'Die Kostenart hat keinen Standard-Umlageschlüssel; bitte wähle einen aus.'
				},
				values: expect.objectContaining({ categoryId: keyless.id })
			}
		});
	});
});

describe('storeReceipt', () => {
	it('names the refusal of the upload checks, so the item page can show it', async () => {
		const db = await testDatabase();
		await ensureDefaults(db, 'a');
		const { propertyId } = await seedUnit(db, 'a');
		const [category] = await listCategories(db, 'a');
		const [key] = await listKeys(db, 'a');
		const item = await createCostItem(db, contextA, {
			propertyId,
			categoryId: category.id,
			allocationKeyId: key.id,
			billingCircleId: null,
			description: 'Grundsteuer 2025',
			supplier: null,
			invoiceDate: null,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 120000,
			allocable: true,
			fuel: null,
			fuelKwh: null,
			co2Kg: null,
			co2Cost: null
		});
		if (!item.ok) throw new Error('setup failed');
		// A row stands in for a full storage; the quota only reads the documents table.
		await db.insert(documents).values({
			accountId: 'a',
			name: 'Groß.pdf',
			mimeType: 'application/pdf',
			size: MAX_ACCOUNT_DOCUMENT_BYTES,
			storageKey: 'a/gross'
		});
		const receipt = new File(['%PDF-1.4'], 'bescheid.pdf', { type: 'application/pdf' });

		const reason = await storeReceipt(db, contextA, item.id, propertyId, receipt);
		expect(reason).toBe('quota');
		expect(itemPage(item.id, reason)).toBe(`/betriebskosten/belege/${item.id}?receiptError=quota`);
		expect(itemPage(item.id)).toBe(`/betriebskosten/belege/${item.id}`);
	});
});
