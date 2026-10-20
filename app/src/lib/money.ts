// Amounts are integer euro cents everywhere; see PROTOTYPE.md "Conventions".

const euro = new Intl.NumberFormat('de-DE', {
	style: 'currency',
	currency: 'EUR',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

const plain = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** `123456` → `1.234,56 €`. */
export function formatCents(cents: number): string {
	return euro.format(cents / 100);
}

/** `123456` → `1.234,56`, for inputs and tables that carry the unit elsewhere. */
export function formatCentsPlain(cents: number): string {
	return plain.format(cents / 100);
}

/** Signed with a leading plus for credits: `+12,00 €`, `-12,00 €`. */
export function formatCentsSigned(cents: number): string {
	return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/**
 * Parses a German or English decimal amount into cents: `1.234,56`, `1234,56`, `1234.56`, `1234`
 * and `-12,5` all work; `€` and whitespace are ignored. Returns undefined for anything else.
 */
export function parseCents(input: string): number | undefined {
	let value = input.replace(/[€\s]/g, '');
	if (!value) return undefined;
	const negative = value.startsWith('-');
	if (negative || value.startsWith('+')) value = value.slice(1);

	const lastComma = value.lastIndexOf(',');
	const lastDot = value.lastIndexOf('.');
	if (lastComma >= 0 && lastDot >= 0) {
		// Both present: the later one is the decimal separator, the other a thousands separator.
		const decimal = lastComma > lastDot ? ',' : '.';
		const thousands = decimal === ',' ? '.' : ',';
		value = value.replaceAll(thousands, '').replace(decimal, '.');
	} else if (lastComma >= 0) {
		if (value.indexOf(',') !== lastComma) return undefined;
		value = value.replace(',', '.');
	} else if (lastDot >= 0 && value.indexOf('.') !== lastDot) {
		// Several dots can only be thousands separators: 1.234.567
		value = value.replaceAll('.', '');
	}

	if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
	const [whole, fraction = ''] = value.split('.');
	const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	if (!Number.isSafeInteger(cents)) return undefined;
	return negative ? -cents : cents;
}

/**
 * Splits `total` cents over `weights` so that the parts sum to `total` exactly. Uses the largest
 * remainder method; ties go to the earlier index, so the same input always gives the same output.
 * A weight of 0 gets 0. All weights 0 (or none) gives all zeros.
 */
export function distributeCents(total: number, weights: readonly number[]): number[] {
	if (!Number.isInteger(total)) throw new Error('distributeCents needs an integer total');
	const sum = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0);
	if (sum <= 0) return weights.map(() => 0);

	const sign = total < 0 ? -1 : 1;
	const absolute = Math.abs(total);
	const exact = weights.map((weight) => (Math.max(0, weight) / sum) * absolute);
	const parts = exact.map((value) => Math.floor(value));
	let remainder = absolute - parts.reduce((acc, part) => acc + part, 0);

	const order = exact
		.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
		.filter((entry) => weights[entry.index] > 0)
		.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
	for (const entry of order) {
		if (remainder <= 0) break;
		parts[entry.index] += 1;
		remainder -= 1;
	}
	return parts.map((part) => part * sign);
}

/** `amount` × `numerator` ÷ `denominator`, rounded half up to a cent. */
export function proRata(amount: number, numerator: number, denominator: number): number {
	if (denominator <= 0) return 0;
	return Math.round((amount * numerator) / denominator);
}
