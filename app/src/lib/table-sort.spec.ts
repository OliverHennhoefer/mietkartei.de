import { describe, expect, it } from 'vitest';
import { byDate, byNumber, bySeverity, byText, TableSort } from './table-sort.svelte';

type Row = { name: string; rent: number | null; since: string | null; hints: number };
const rows: Row[] = [
	{ name: 'Özdemir', rent: 900, since: '2019-03-01', hints: 0 },
	{ name: 'Berger', rent: null, since: null, hints: 2 },
	{ name: 'andersen', rent: 1200, since: '2024-07-01', hints: 1 },
	{ name: 'Zander', rent: 700, since: '2021-01-15', hints: 2 }
];
const names = (list: Row[]) => list.map((row) => row.name);

function table() {
	return new TableSort<Row>({
		name: byText((row) => row.name),
		rent: byNumber((row) => row.rent),
		since: byDate((row) => row.since),
		hints: bySeverity((row) => row.hints)
	});
}

describe('TableSort', () => {
	it('keeps the default order until a column is chosen', () => {
		const sort = table();
		expect(sort.rows(rows)).toBe(rows);
		expect(sort.active).toBe(false);
	});

	it('sorts text A–Z, then Z–A, then back to the default order', () => {
		const sort = table();
		sort.toggle('name');
		expect(names(sort.rows(rows))).toEqual(['andersen', 'Berger', 'Özdemir', 'Zander']);
		expect(sort.ariaSort('name')).toBe('ascending');
		sort.toggle('name');
		expect(names(sort.rows(rows))).toEqual(['Zander', 'Özdemir', 'Berger', 'andersen']);
		expect(sort.ariaSort('name')).toBe('descending');
		sort.toggle('name');
		expect(sort.rows(rows)).toBe(rows);
		expect(sort.ariaSort('name')).toBeUndefined();
	});

	it('sorts amounts and dates largest and latest first, empty values always last', () => {
		const sort = table();
		sort.toggle('rent');
		expect(names(sort.rows(rows))).toEqual(['andersen', 'Özdemir', 'Zander', 'Berger']);
		sort.toggle('rent');
		expect(names(sort.rows(rows))).toEqual(['Zander', 'Özdemir', 'andersen', 'Berger']);
		sort.toggle('since');
		expect(names(sort.rows(rows))).toEqual(['andersen', 'Zander', 'Özdemir', 'Berger']);
	});

	it('puts the most hints first and keeps the default order between equals', () => {
		const sort = table();
		sort.toggle('hints');
		expect(names(sort.rows(rows))).toEqual(['Berger', 'Zander', 'andersen', 'Özdemir']);
		sort.toggle('hints');
		expect(names(sort.rows(rows))).toEqual(['Özdemir', 'andersen', 'Berger', 'Zander']);
	});

	it('starts a newly chosen column in its own first direction', () => {
		const sort = table();
		sort.toggle('name');
		sort.toggle('name');
		sort.toggle('rent');
		expect(sort.direction).toBe('desc');
		expect(sort.ariaSort('name')).toBeUndefined();
	});

	it('compares numbers inside text naturally', () => {
		const sort = new TableSort<{ label: string }>({ label: byText((row) => row.label) });
		sort.toggle('label');
		expect(
			sort.rows([{ label: 'Wohnung 10' }, { label: 'Wohnung 2' }]).map((row) => row.label)
		).toEqual(['Wohnung 2', 'Wohnung 10']);
	});
});
