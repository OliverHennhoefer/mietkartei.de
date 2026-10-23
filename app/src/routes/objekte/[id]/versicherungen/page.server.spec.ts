import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getPolicy, listPolicies } from '#lib/server/insurance.ts';
import { outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { load as loadReceipt } from '../../../betriebskosten/belege/neu/+page.server';
import { actions as policyActions, load as loadPolicy } from './[policyId]/+page.server';
import { actions, load } from './+page.server';

let db: Database;
let propertyId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId } = await seedUnit(db, 'a'));
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1]) {
	return outcome(() =>
		handler(routeEvent(db, { parent: { property: { id: propertyId } }, ...options }))
	);
}

const fields = {
	kind: 'building',
	insurer: 'Allianz',
	annualPremium: '1.200,00',
	renewalDate: '2025-01-01',
	noticeMonths: '3'
};

async function createPolicy(form: Record<string, string> = fields, id = propertyId) {
	return run(actions.create, { params: { id }, form });
}

describe('objekte/[id]/versicherungen', () => {
	it('creates a policy and lists it with its insurance years', async () => {
		expect(await createPolicy()).toEqual({ redirect: `/objekte/${propertyId}/versicherungen` });
		expect(await run(load, { params: { id: propertyId } })).toMatchObject({
			data: {
				policies: [
					{
						kind: 'building',
						insurer: 'Allianz',
						annualPremium: 1200_00,
						renewalDate: '2025-01-01',
						years: expect.arrayContaining([
							expect.objectContaining({ start: '2025-01-01', costItemId: null })
						])
					}
				]
			}
		});
	});

	it('refuses bad fields and a foreign property', async () => {
		expect(
			await createPolicy({ ...fields, noticeMonths: '30', endDate: '2024-12-31' })
		).toMatchObject({
			fail: 400,
			data: {
				errors: {
					noticeMonths: 'Der Wert darf nicht über 24 liegen.',
					endDate: 'Das Ende darf nicht vor der Hauptfälligkeit liegen.'
				}
			}
		});
		const other = await seedUnit(db, 'b');
		expect(await createPolicy(fields, other.propertyId)).toMatchObject({ error: 404 });
	});

	it('edits and deletes a policy, and answers 404 under another property', async () => {
		await createPolicy();
		const [{ id: policyId }] = await listPolicies(db, 'a', propertyId);
		const params = { id: propertyId, policyId };
		expect(await run(loadPolicy, { params })).toMatchObject({ data: { policy: { id: policyId } } });
		expect(
			await run(policyActions.update, { params, form: { ...fields, insurer: 'HUK' } })
		).toEqual({ redirect: `/objekte/${propertyId}/versicherungen` });
		expect((await getPolicy(db, 'a', policyId))?.insurer).toBe('HUK');

		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		for (const handler of [loadPolicy, policyActions.update, policyActions.delete]) {
			expect(
				await run(handler, { params: { id: other.propertyId, policyId }, form: fields })
			).toMatchObject({ error: 404 });
		}

		expect(await run(policyActions.delete, { params })).toEqual({
			redirect: `/objekte/${propertyId}/versicherungen`
		});
		expect(await getPolicy(db, 'a', policyId)).toBeUndefined();
	});

	it('prefills a new Beleg from an insurance year', async () => {
		await createPolicy();
		const [{ id: policyId }] = await listPolicies(db, 'a', propertyId);
		expect(
			await run(loadReceipt, {
				url: `/betriebskosten/belege/neu?versicherung=${policyId}&von=2026-01-01`
			})
		).toMatchObject({
			data: {
				prefill: {
					propertyId,
					supplier: 'Allianz',
					periodStart: '2026-01-01',
					periodEnd: '2026-12-31',
					amount: 1200_00,
					allocable: true,
					categoryId: expect.any(String)
				}
			}
		});
		// An unknown policy falls back to the plain form.
		expect(
			await run(loadReceipt, { url: '/betriebskosten/belege/neu?versicherung=x&von=2026-01-01' })
		).toMatchObject({ data: { prefill: { propertyId: undefined } } });
	});
});
