import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { today } from '../dates';
import {
	computeTool,
	newTenancy,
	newToolState,
	newUnit,
	type ToolItem,
	type ToolState
} from '../domain/statement-tool';
import type { Database } from './db';
import { allocationKeys, costCategories, costItems, leases, meters, properties } from './db/schema';
import { ensureDefaults } from './operating-costs';
import { getStatement } from './statements';
import { importToolState } from './statement-tool-import';
import { contextA, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

/** Two flats, the second with a tenant change, and every kind of key the tool offers. */
function house(): ToolState {
	const state = newToolState(today());
	state.landlord.name = 'Eva Beispiel';
	state.property = { name: '', street: 'Gartenweg 5', postalCode: '04109', city: 'Leipzig' };
	const eg = newUnit(1);
	eg.name = 'EG';
	eg.area = '60';
	eg.tenancies[0] = {
		...eg.tenancies[0],
		lastName: 'Erdmann',
		persons: '2',
		operatingCostPrepayment: '150',
		heatingCostPrepayment: '80'
	};
	const og = newUnit(2);
	og.name = 'OG';
	og.area = '40';
	og.tenancies = [
		{
			...newTenancy(),
			lastName: 'Alt',
			end: `${year(state)}-06-30`,
			operatingCostPrepayment: '50'
		},
		{
			...newTenancy(),
			lastName: 'Neu',
			start: `${year(state)}-07-15`,
			operatingCostPrepayment: '60'
		}
	];
	state.units = [eg, og];
	const fill = (category: number, amount: string, change: Partial<ToolItem> = {}) =>
		Object.assign(
			state.items.find((item) => item.category === category)!,
			{ amount, ...change }
		);
	fill(1, '1000');
	fill(2, '900', { key: 'consumption', meter: 'cold_water' });
	fill(4, '3000', {
		key: 'mixed',
		consumptionPercent: 70,
		meter: 'heat',
		co2: { fuel: 'gas', fuelKwh: '20000', co2Kg: '', co2Cost: '250' }
	});
	fill(8, '365', { key: 'persons' });
	fill(5, '700', {
		key: 'direct',
		amounts: { [eg.id]: '400', [og.tenancies[0].id]: '120', [og.tenancies[1].id]: '150' }
	});
	state.consumption.cold_water = { [eg.id]: '60', [og.id]: '30' };
	state.consumption.heat = { [eg.id]: '6000', [og.id]: '4000' };
	return state;
}

function year(state: ToolState): number {
	return Number(state.periodStart.slice(0, 4));
}

describe('importToolState', () => {
	it('creates the house and a draft that computes what the tool showed', async () => {
		const state = house();
		const expected = computeTool(state, today()).statement!;
		const result = await importToolState(db, contextA, state);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const view = (await getStatement(db, 'a', result.statementId))!;
		const summary = (leases: typeof expected.leases) =>
			leases
				.map((lease) => ({
					name: lease.tenants[0].lastName,
					costs: lease.costsTotal,
					prepayments: lease.prepaymentsTotal,
					balance: lease.balance,
					lines: lease.lines.map((line) => [line.categoryName, line.amount])
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
		expect(summary(view.result.leases)).toEqual(summary(expected.leases));
		expect(view.result.property.landlordCo2Share).toBe(expected.property.landlordCo2Share);
		expect(view.blocking).toEqual([]);

		const [property] = await db.select().from(properties).where(eq(properties.accountId, 'a'));
		expect(property).toMatchObject({ name: 'Gartenweg 5', city: 'Leipzig' });
		expect(await db.select().from(costItems)).toHaveLength(5);
		expect(await db.select().from(meters)).toHaveLength(4);
		// The rent accounts start this month: the period's prepayments come from the history.
		const thisMonth = `${today().slice(0, 7)}-01`;
		const ledgerStarts = (await db.select().from(leases)).map((lease) => lease.ledgerStart);
		expect(ledgerStarts).toEqual([thisMonth, thisMonth, thisMonth]);
	});

	it('adds a Kostenart the account removed and a key it does not have', async () => {
		await ensureDefaults(db, 'a');
		await db.delete(costCategories).where(eq(costCategories.betrkvItem, 1));
		const state = house();
		// Both heating and hot water at 50 %: one new key for the house, shared by the two.
		Object.assign(
			state.items.find((item) => item.category === 4)!,
			{ consumptionPercent: 50 }
		);
		Object.assign(
			state.items.find((item) => item.category === 5)!,
			{
				key: 'mixed',
				consumptionPercent: 50,
				meter: 'heat'
			}
		);
		const result = await importToolState(db, contextA, state);
		expect(result.ok).toBe(true);
		const grundsteuer = await db
			.select()
			.from(costCategories)
			.where(eq(costCategories.betrkvItem, 1));
		expect(grundsteuer).toHaveLength(1);
		const houseKeys = (await db.select().from(allocationKeys)).filter(
			(key) => key.propertyId !== null
		);
		// Cold water by consumption has no account key either.
		expect(
			houseKeys.map((key) => [key.kind, key.meterKind, key.consumptionPercent]).sort()
		).toEqual([
			['consumption', 'cold_water', null],
			['mixed', 'heat', 50]
		]);
	});

	it('refuses a file that is not complete', async () => {
		const state = house();
		state.units[0].tenancies[0].lastName = '';
		const result = await importToolState(db, contextA, state);
		expect(result).toEqual({
			ok: false,
			message:
				'Die Abrechnung in der Datei ist noch nicht vollständig: EG: Trage den Namen des Mieters ein.'
		});
		expect(await db.select().from(properties)).toEqual([]);
	});
});
