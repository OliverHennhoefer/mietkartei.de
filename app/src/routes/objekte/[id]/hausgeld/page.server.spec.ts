import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import {
	getAssociationStatement,
	listAssociationStatements
} from '#lib/server/association-statements.ts';
import { outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions as statementActions, load as loadStatement } from './[statementId]/+page.server';
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
	periodStart: '2025-01-01',
	periodEnd: '2025-12-31',
	allocableCosts: '1.800,00',
	nonAllocableCosts: '600,00',
	reserveContribution: '400,00',
	feesDue: '3.000,00',
	statedBalance: '200,00',
	balanceKind: 'credit',
	note: ''
};

async function createStatement(form: Record<string, string> = fields, id = propertyId) {
	return run(actions.create, { params: { id }, form });
}

describe('objekte/[id]/hausgeld', () => {
	it('creates a Hausgeldabrechnung and lists it reconciled', async () => {
		expect(await createStatement()).toEqual({ redirect: `/objekte/${propertyId}/hausgeld` });
		expect(await run(load, { params: { id: propertyId } })).toMatchObject({
			data: {
				statements: [
					{ periodStart: '2025-01-01', feesDue: 3000_00, statedBalance: -200_00, feesPaid: 0 }
				]
			}
		});
	});

	it('refuses bad fields, a second statement for the period and a foreign property', async () => {
		expect(await createStatement({ ...fields, periodEnd: '2024-12-31' })).toMatchObject({
			fail: 400,
			data: { errors: { periodEnd: expect.any(String) } }
		});
		await createStatement();
		expect(await createStatement()).toMatchObject({
			fail: 400,
			data: { errors: { periodStart: expect.any(String) }, values: { feesDue: '3.000,00' } }
		});
		const other = await seedUnit(db, 'b');
		expect(await createStatement(fields, other.propertyId)).toMatchObject({ error: 404 });
	});

	it('edits and deletes a statement, and answers 404 under another property', async () => {
		await createStatement();
		await createStatement({ ...fields, periodStart: '2024-01-01', periodEnd: '2024-12-31' });
		const [{ id: statementId }] = (await listAssociationStatements(db, 'a', propertyId)).filter(
			(statement) => statement.periodStart === '2025-01-01'
		);
		const params = { id: propertyId, statementId };
		expect(await run(loadStatement, { params })).toMatchObject({
			data: { statement: { id: statementId } }
		});
		expect(
			await run(statementActions.update, { params, form: { ...fields, feesDue: '3.600,00' } })
		).toEqual({ redirect: `/objekte/${propertyId}/hausgeld` });
		expect((await getAssociationStatement(db, 'a', statementId))?.feesDue).toBe(3600_00);
		expect(
			await run(statementActions.update, { params, form: { ...fields, feesDue: 'x' } })
		).toMatchObject({ fail: 400 });
		expect(
			await run(statementActions.update, {
				params,
				form: { ...fields, periodStart: '2024-01-01', periodEnd: '2024-12-31' }
			})
		).toMatchObject({ fail: 400, data: { errors: { periodStart: expect.any(String) } } });

		const other = await seedUnit(db, 'a', { propertyName: 'Anderes Haus' });
		for (const handler of [loadStatement, statementActions.update, statementActions.delete]) {
			expect(
				await run(handler, { params: { id: other.propertyId, statementId }, form: fields })
			).toMatchObject({ error: 404 });
		}

		expect(await run(statementActions.delete, { params })).toEqual({
			redirect: `/objekte/${propertyId}/hausgeld`
		});
		expect(await getAssociationStatement(db, 'a', statementId)).toBeUndefined();
	});
});
