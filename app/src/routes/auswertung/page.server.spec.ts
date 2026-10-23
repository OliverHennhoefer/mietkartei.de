import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { listExpenses } from '#lib/server/expenses.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions, load as loadExpenses } from './ausgaben/+page.server';
import { load } from './+page.server';

let db: Database;
let propertyId: string;
let unitId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
	await seedLease(db, 'a', unitId, { startDate: '2024-01-01' });
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, options)));
}

const year = Number(new Date().toISOString().slice(0, 4));

describe('auswertung', () => {
	it('shows the current year by default, a chosen year or all years', async () => {
		expect(await run(load)).toMatchObject({ data: { period: year, propertyId: null } });
		expect(await run(load, { url: '/auswertung?jahr=2024' })).toMatchObject({
			data: { period: 2024, series: { length: 12 } }
		});
		const all = await run(load, { url: `/auswertung?jahr=gesamt&objekt=${propertyId}` });
		expect(all).toMatchObject({ data: { period: 'all', propertyId } });
		expect((all as { data: { years: number[] } }).data.years.at(-1)).toBe(2024);
		// Nonsense falls back to the current year.
		expect(await run(load, { url: '/auswertung?jahr=abc' })).toMatchObject({
			data: { period: year }
		});
	});
});

describe('auswertung/ausgaben', () => {
	it('creates an expense on a unit, lists it in its year and deletes it', async () => {
		expect(
			await run(actions.create, {
				form: {
					date: `${year}-02-01`,
					amount: '89,90',
					category: 'maintenance',
					scope: `unit:${unitId}`,
					description: 'Silikonfuge'
				}
			})
		).toMatchObject({ data: { created: expect.any(String) } });
		const [expense] = await listExpenses(db, 'a');
		expect(await run(loadExpenses)).toMatchObject({
			data: { year, expenses: [{ id: expense.id, amount: 8990 }] }
		});
		expect(await run(actions.delete, { form: { id: expense.id } })).toEqual({
			data: { deleted: expense.id }
		});
		expect(await run(actions.delete, { form: { id: expense.id } })).toMatchObject({ fail: 404 });
	});

	it('offers every year back to the earliest expense', async () => {
		expect(
			await run(actions.create, {
				form: {
					date: '2015-06-01',
					amount: '10',
					category: 'other',
					scope: '',
					description: 'Alt'
				}
			})
		).toMatchObject({ data: { year: 2015 } });
		const page = (await run(loadExpenses)) as { data: { years: number[] } };
		expect(page.data.years[0]).toBe(year);
		expect(page.data.years.at(-1)).toBe(2015);
		expect(await run(loadExpenses, { url: '/auswertung/ausgaben?jahr=2015' })).toMatchObject({
			data: { year: 2015, expenses: [{ description: 'Alt' }] }
		});
	});

	it("refuses a form error and another account's unit", async () => {
		const other = await seedUnit(db, 'b');
		expect(
			await run(actions.create, {
				form: {
					date: `${year}-02-01`,
					amount: '10',
					category: 'other',
					scope: `unit:${other.unitId}`,
					description: 'x'
				}
			})
		).toMatchObject({ fail: 400, data: { errors: { scope: 'Diese Zuordnung gibt es nicht.' } } });
		expect(await run(actions.create, { form: { amount: 'x' } })).toMatchObject({ fail: 400 });
		expect(await listExpenses(db, 'a')).toEqual([]);
	});
});
