// Sorting a table by a click on a column heading (see SortHeader). Each table keeps its own
// order as the default: the first click sorts by the column in its natural direction, the second
// reverses it, the third returns to the default order.

export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;

export type SortColumn<T> = {
	value: (row: T) => SortValue;
	/** The direction of the first click. */
	first: SortDirection;
};

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Text, A–Z first. */
export function byText<T>(value: (row: T) => string | null | undefined): SortColumn<T> {
	return { value, first: 'asc' };
}

/** Amounts and counts, the largest first. */
export function byNumber<T>(value: (row: T) => number | null | undefined): SortColumn<T> {
	return { value, first: 'desc' };
}

/** Dates and ISO dates (YYYY-MM-DD, YYYY-MM), the latest first. */
export function byDate<T>(value: (row: T) => Date | string | null | undefined): SortColumn<T> {
	return {
		value: (row) => {
			const date = value(row);
			return date instanceof Date ? date.toISOString() : date;
		},
		first: 'desc'
	};
}

/** Status and hints, ranked by weight: the most urgent first. */
export function bySeverity<T>(value: (row: T) => number): SortColumn<T> {
	return { value, first: 'desc' };
}

/** Empty values always go last, whichever the direction; ties keep the default order. */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
	const aEmpty = a === null || a === undefined || a === '';
	const bEmpty = b === null || b === undefined || b === '';
	if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
	const order =
		typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
	return direction === 'asc' ? order : -order;
}

export class TableSort<T, K extends string = string> {
	key = $state<K | null>(null);
	direction = $state<SortDirection>('asc');
	readonly #columns: Record<K, SortColumn<T>>;

	constructor(columns: Record<K, SortColumn<T>>) {
		this.#columns = columns;
	}

	/** Whether the rows are in an order of the user's choosing instead of the table's own. */
	get active() {
		return this.key !== null;
	}

	toggle(key: K) {
		const first = this.first(key);
		if (this.key !== key) {
			this.key = key;
			this.direction = first;
		} else if (this.direction === first) {
			this.direction = first === 'asc' ? 'desc' : 'asc';
		} else {
			this.key = null;
		}
	}

	first(key: K): SortDirection {
		return this.#columns[key].first;
	}

	ariaSort(key: K): 'ascending' | 'descending' | undefined {
		if (this.key !== key) return undefined;
		return this.direction === 'asc' ? 'ascending' : 'descending';
	}

	/** The rows in the chosen order, or as given while no column is chosen. */
	rows<R extends T>(rows: readonly R[]): R[] {
		const key = this.key;
		if (key === null) return rows as R[];
		const { value } = this.#columns[key];
		const direction = this.direction;
		return rows
			.map((row) => ({ row, value: value(row) }))
			.sort((a, b) => compareSortValues(a.value, b.value, direction))
			.map(({ row }) => row);
	}
}
