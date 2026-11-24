import { describe, expect, it } from 'vitest';
import { renderLetter } from '../server/pdf';
import { statementLetter } from './statement-letter';
import {
	computeTool,
	formatTyped,
	itemsTotal,
	newItem,
	newTenancy,
	newToolState,
	newUnit,
	nextPeriod,
	parseToolFile,
	toolFile,
	toolInput,
	toolIssues,
	type ToolItem,
	type ToolState
} from './statement-tool';

const today = '2026-03-01';

/** A house with two flats; the second changes tenants on 1 July. */
function house(): ToolState {
	const state = newToolState(today);
	state.landlord = {
		name: 'Eva Beispiel',
		street: 'Lindenallee 3',
		postalCode: '04109',
		city: 'Leipzig',
		iban: 'DE02 1203 0000 0000 2020 51'
	};
	state.property = { name: '', street: 'Gartenweg 5', postalCode: '04109', city: 'Leipzig' };
	const eg = newUnit(1);
	eg.name = 'EG';
	eg.area = '60';
	eg.tenancies[0] = {
		...eg.tenancies[0],
		salutation: 'Frau',
		firstName: 'Anna',
		lastName: 'Erdmann',
		persons: '2',
		operatingCostPrepayment: '100'
	};
	const og = newUnit(2);
	og.name = 'OG';
	og.area = '40';
	og.tenancies = [
		{ ...newTenancy(), lastName: 'Alt', end: '2025-06-30', operatingCostPrepayment: '50' },
		{ ...newTenancy(), lastName: 'Neu', start: '2025-07-01', operatingCostPrepayment: '60' }
	];
	state.units = [eg, og];
	return state;
}

function fill(state: ToolState, category: number, amount: string, change: Partial<ToolItem> = {}) {
	const item = state.items.find((entry) => entry.category === category)!;
	Object.assign(item, { amount, ...change });
	return item;
}

describe('newToolState', () => {
	it('opens on last calendar year with the 17 Kostenarten and nothing to print', () => {
		const state = newToolState(today);
		expect(state.periodStart).toBe('2025-01-01');
		expect(state.periodEnd).toBe('2025-12-31');
		expect(state.items.map((item) => item.category)).toEqual(
			Array.from({ length: 17 }, (_, index) => index + 1)
		);
		expect(state.items.find((item) => item.category === 4)).toMatchObject({
			key: 'mixed',
			meter: 'heat',
			consumptionPercent: 70
		});
		// A combined system is split by the meter service: amounts per flat.
		expect(state.items.find((item) => item.category === 6)?.key).toBe('direct');
		expect(computeTool(state, today).ready).toBe(false);
	});
});

describe('computeTool', () => {
	it('splits by area and person-days, with the tenant change by days', () => {
		const state = house();
		fill(state, 1, '1.000,00');
		fill(state, 8, '365', { key: 'persons' });
		const { statement, ready, issues } = computeTool(state, today);
		expect(issues).toEqual([]);
		expect(ready).toBe(true);
		const byName = Object.fromEntries(
			statement!.leases.map((lease) => [lease.tenants[0].lastName, lease])
		);
		// Grundsteuer by area: 60 and 40 of 100 m², the OG split by its 181 and 184 days.
		expect(byName.Erdmann.lines[0].amount).toBe(60000);
		expect(byName.Alt.lines[0].amount + byName.Neu.lines[0].amount).toBe(40000);
		expect(byName.Alt.lines[0].amount).toBe(19836);
		// Müll by persons: 2 × 365 of 2 × 365 + 181 + 184 person-days.
		expect(byName.Erdmann.lines[1].amount).toBe(24333);
		// Prepayments as agreed: 12 × 100 €, 6 × 50 €.
		expect(byName.Erdmann.prepaymentsTotal).toBe(120000);
		expect(byName.Alt.prepaymentsTotal).toBe(30000);
		expect(byName.Erdmann.balance).toBe(60000 + 24333 - 120000);
		// Frozen as approved today: a Guthaben is due in 30 days.
		expect(byName.Erdmann).toMatchObject({ approvedOn: today, dueDate: '2026-03-31' });
		expect(byName.Erdmann.posted).toBe(byName.Erdmann.balance);
	});

	it('prints the app letter with the agreed prepayments in the Prüfprotokoll', async () => {
		const state = house();
		fill(state, 1, '1000');
		const lease = computeTool(state, today).statement!.leases[0];
		const letter = statementLetter(lease, { prepayments: 'entered' });
		expect(letter.recipient).toEqual(['Frau Anna Erdmann', 'Gartenweg 5', '04109 Leipzig']);
		expect(letter.subject).toBe('Betriebskostenabrechnung 2025 – Gartenweg 5, EG');
		const rows = Object.fromEntries(
			letter.appendix!.blocks.flatMap((block) => ('table' in block ? block.table.rows : []))
		);
		expect(rows.Vorauszahlungen).toBe(
			'Vereinbarte Vorauszahlungen angerechnet: 12 Monate, zusammen 1.200,00 €.'
		);
		const bytes = await renderLetter(letter);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
	});

	it('asks for the consumption a key needs and stops the PDF until it is there', () => {
		const state = house();
		fill(state, 2, '900', { key: 'consumption', meter: 'cold_water' });
		const unit = state.units[0];
		state.consumption.cold_water[unit.id] = '60';
		const first = computeTool(state, today);
		expect(first.ready).toBe(false);
		expect(first.statement!.warnings.map((warning) => warning.message)).toContain(
			'Für OG fehlt der Verbrauch (Kaltwasser). Trag ihn bei den Verbräuchen ein, auch wenn er 0 ist.'
		);
		state.consumption.cold_water[state.units[1].id] = '30';
		const second = computeTool(state, today);
		expect(second.ready).toBe(true);
		const erdmann = second.statement!.leases.find((l) => l.tenants[0].lastName === 'Erdmann')!;
		expect(erdmann.lines[0]).toMatchObject({ amount: 60000, keyTotal: '90 m³' });
	});

	it('takes the amounts of the meter service per flat and per tenant after a change', () => {
		const state = house();
		const item = fill(state, 6, '2000', { key: 'direct' });
		const [eg, og] = state.units;
		item.amounts = {
			[eg.id]: '1200',
			[og.tenancies[0].id]: '300',
			[og.tenancies[1].id]: '500'
		};
		const { statement, ready } = computeTool(state, today);
		expect(ready).toBe(true);
		const amounts = Object.fromEntries(
			statement!.leases.map((lease) => [lease.tenants[0].lastName, lease.lines[0].amount])
		);
		expect(amounts).toEqual({ Erdmann: 120000, Alt: 30000, Neu: 50000 });
		expect(toolInput(state).items[0].unitAmounts).toEqual([
			{ unitId: eg.id, leaseId: null, amount: 120000 },
			{ unitId: og.id, leaseId: og.tenancies[0].id, amount: 30000 },
			{ unitId: og.id, leaseId: og.tenancies[1].id, amount: 50000 }
		]);
	});

	it('takes the landlord’s CO₂ share off a gas bill', () => {
		const state = house();
		const item = fill(state, 4, '3000', { key: 'mixed', consumptionPercent: 70, meter: 'heat' });
		item.co2 = { fuel: 'gas', fuelKwh: '20000', co2Kg: '', co2Cost: '250' };
		state.consumption.heat = { [state.units[0].id]: '600', [state.units[1].id]: '400' };
		const { statement } = computeTool(state, today);
		// 20,000 kWh × 0.201 = 4,020 kg on 100 m²: 40.2 kg/m², the landlord bears 60 %.
		const line = statement!.leases[0].lines[0];
		expect(line.co2).toMatchObject({ co2Kg: 4020, landlordPercent: 60, landlordAmount: 15000 });
		expect(line.allocated).toBe(285000);
	});

	it('names what is missing or wrong before computing', () => {
		const state = house();
		state.landlord.name = '';
		state.units[1].tenancies[0].end = '';
		fill(state, 1, 'zwölf');
		expect(toolIssues(state).map((issue) => issue.message)).toEqual([
			'Trage deinen Namen als Vermieter ein.',
			'OG: Alt und Neu wohnen zur gleichen Zeit dort. Trage beim früheren Mieter das Auszugsdatum ein.',
			'Grundsteuer: Der Betrag ist kein Betrag.'
		]);
		expect(computeTool(state, today).ready).toBe(false);
	});

	it('checks every number the form takes', () => {
		const state = house();
		state.property.city = '';
		const [eg, og] = state.units;
		eg.area = 'groß';
		Object.assign(eg.tenancies[0], {
			start: '2025-13-01',
			persons: '1,5',
			operatingCostPrepayment: '-5',
			heatingCostPrepayment: 'viel'
		});
		og.tenancies[0].end = '30.06.2025';
		og.tenancies[1].lastName = '';
		og.tenancies[1].start = '2025-08-01';
		og.tenancies[1].end = '2025-07-01';
		fill(state, 5, '700', { key: 'direct', amounts: { [eg.id]: 'x' } });
		fill(state, 4, '3000', {
			key: 'consumption',
			meter: 'heat',
			co2: { fuel: 'gas', fuelKwh: 'a', co2Kg: '-1', co2Cost: 'b' }
		});
		state.consumption.heat = { [eg.id]: 'zehn' };
		expect(toolIssues(state).map((issue) => issue.message)).toEqual([
			'Trage die Adresse des Hauses ein.',
			'EG: Die Wohnfläche ist keine Zahl.',
			'EG, Anna Erdmann: Das Einzugsdatum fehlt.',
			'EG, Anna Erdmann: Die Personenzahl ist keine ganze Zahl.',
			'EG, Anna Erdmann: Die Vorauszahlung für Betriebskosten ist kein Betrag.',
			'EG, Anna Erdmann: Die Vorauszahlung für Heizkosten ist kein Betrag.',
			'OG, Alt: Das Auszugsdatum fehlt.',
			'OG: Trage den Namen des Mieters ein.',
			'OG, Mieter ohne Namen: Der Auszug liegt vor dem Einzug.',
			// Without a valid move-out date the earlier tenant counts as still living there.
			'OG: Alt und Mieter ohne Namen wohnen zur gleichen Zeit dort. Trage beim früheren Mieter das Auszugsdatum ein.',
			'Heizung: Die kWh sind keine Zahl.',
			'Heizung: Die kg CO₂ sind keine Zahl.',
			'Heizung: Die CO₂-Kosten sind kein Betrag.',
			'Warmwasser: Der Betrag für EG ist kein Betrag.',
			'Heizung: Der Verbrauch von EG ist keine Zahl.'
		]);
	});

	it('asks for a house with at least one flat', () => {
		const state = house();
		state.units = [];
		expect(toolIssues(state).map((issue) => issue.message)).toContain(
			'Lege mindestens eine Wohnung an.'
		);
		expect(computeTool(state, today).ready).toBe(false);
	});

	it('explains a flat without area and a flat left empty', () => {
		const state = house();
		state.units[1].area = '';
		const empty = newUnit(3);
		empty.name = 'DG';
		empty.area = '20';
		empty.tenancies = [];
		state.units.push(empty);
		fill(state, 1, '1000');
		const messages = computeTool(state, today).statement!.warnings.map((w) => w.message);
		expect(messages).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/OG fehlt die Wohnfläche/),
				expect.stringMatching(/DG stand im ganzen Zeitraum leer/)
			])
		);
	});

	it('takes the kg CO₂ from the bill when they are given', () => {
		const state = house();
		const item = fill(state, 4, '3000', { key: 'area' });
		item.co2 = { fuel: 'gas', fuelKwh: '', co2Kg: '1500', co2Cost: '250' };
		const line = computeTool(state, today).statement!.leases[0].lines[0];
		expect(line.co2).toMatchObject({ co2Kg: 1500 });
	});

	it('sums the filled amounts and formats what was typed', () => {
		const state = house();
		fill(state, 1, '1.000,50');
		fill(state, 2, '99');
		expect(itemsTotal(state)).toBe(109950);
		expect(formatTyped('1234,5')).toMatch(/^1\.234,50\s€$/);
		expect(formatTyped('abc')).toBe('');
	});

	it('computes nothing for an invalid period', () => {
		const state = house();
		state.periodEnd = '2026-06-30';
		const result = computeTool(state, today);
		expect(result.statement).toBeNull();
		expect(result.issues[0].message).toMatch(/höchstens 12 Monate/);
	});
});

describe('nextPeriod', () => {
	it('keeps the house and the tenants still there, without amounts', () => {
		const state = house();
		fill(state, 1, '1000');
		state.consumption.cold_water[state.units[0].id] = '12';
		const next = nextPeriod(state);
		expect(next).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-12-31' });
		expect(next.units[1].tenancies.map((tenancy) => [tenancy.lastName, tenancy.start])).toEqual([
			['Neu', '']
		]);
		expect(next.items.every((item) => item.amount === '')).toBe(true);
		expect(next.consumption.cold_water).toEqual({});
	});
});

describe('toolFile', () => {
	it('reads back what it wrote', () => {
		const state = house();
		fill(state, 1, '1000');
		expect(parseToolFile(toolFile(state), today)).toEqual(state);
	});

	it('rejects other files and repairs odd entries', () => {
		expect(parseToolFile('{"format":"other","version":1}', today)).toBeUndefined();
		expect(parseToolFile('kein JSON', today)).toBeUndefined();
		const parsed = parseToolFile(
			JSON.stringify({
				format: 'mietkartei-nebenkostenabrechnung',
				version: 1,
				units: [{ tenancies: [{ start: 'gestern', persons: 3 }] }],
				items: [{ category: 99 }, { category: 2, key: 'magic', consumptionPercent: 90 }]
			}),
			today
		)!;
		expect(parsed.units[0]).toMatchObject({ name: 'Wohnung 1' });
		expect(parsed.units[0].tenancies[0]).toMatchObject({ start: '', persons: '3' });
		expect(parsed.items).toHaveLength(1);
		expect(parsed.items[0]).toMatchObject({ key: 'area', consumptionPercent: 70 });
		expect(newItem(2).meter).toBe('cold_water');
	});
});
