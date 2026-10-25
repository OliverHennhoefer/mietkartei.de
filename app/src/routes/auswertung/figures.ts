import { formatNumber } from '#lib/format.ts';

// How the Auswertung pages write shares and rents per m².

export function percent(value: number | null): string {
	return value === null ? '–' : `${formatNumber(value * 100, 1)} %`;
}

const perSqmFormat = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

export function perSqm(value: number | null): string {
	return value === null ? '–' : `${perSqmFormat.format(value)} €/m²`;
}
