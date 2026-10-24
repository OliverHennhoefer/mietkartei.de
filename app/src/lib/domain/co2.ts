import { formatNumber } from '../format';
import { formatCents, proRata } from '../money';
import type { BuildingUse } from '../server/db/schema';

// Kohlendioxidkostenaufteilungsgesetz (CO2KostAufG): the landlord bears a share of the CO₂ cost of
// heating that grows with the building's emissions per square metre. Two cases use this file: the
// statement (landlord buys the fuel, §§ 5, 7) and the stand-alone split for a tenant with an own
// fuel contract (§ 6). The reductions of § 9 (Denkmalschutz, Milieuschutz) are not modelled.

/**
 * Anlage 1 CO2KostAufG: the landlord's share for residential buildings by annual emissions in kg
 * CO₂ per m² living area. Each row is the lower bound of the tier and the landlord's percent.
 */
export const residentialTiers: ReadonlyArray<readonly [number, number]> = [
	[0, 0],
	[12, 10],
	[17, 20],
	[22, 30],
	[27, 40],
	[32, 50],
	[37, 60],
	[42, 70],
	[47, 80],
	[52, 95]
];

/** § 8: non-residential buildings split half and half. */
const NON_RESIDENTIAL_LANDLORD_PERCENT = 50;

/** The landlord's share in percent for the given emissions per m² and year. */
export function landlordSharePercent(kgPerSquareMetre: number, use: BuildingUse): number {
	if (use === 'non_residential') return NON_RESIDENTIAL_LANDLORD_PERCENT;
	let percent = 0;
	for (const [lowerBound, tierPercent] of residentialTiers) {
		if (kgPerSquareMetre >= lowerBound) percent = tierPercent;
	}
	return percent;
}

/** Emission factors in kg CO₂ per kWh, to prefill the kg when the invoice does not state them. */
const emissionFactors: Record<string, number | undefined> = {
	gas: 0.201,
	oil: 0.266,
	lpg: 0.234
};

/**
 * The CO₂ emissions in kg for a fuel bill, from the kWh and the emission factor of the fuel, to
 * one decimal. Null when the fuel has no factor (district heating, other) or the kWh are unknown:
 * then the supplier's figure has to be typed in.
 */
export function co2KgFromKwh(fuel: string | null, fuelKwh: number | null): number | null {
	if (!fuel || fuelKwh === null) return null;
	const factor = emissionFactors[fuel];
	if (factor === undefined) return null;
	return Math.round(fuelKwh * factor * 10) / 10;
}

export type Co2SplitInput = {
	/** Emissions of the year in kg CO₂, as printed on the supplier invoice. */
	co2Kg: number;
	/** CO₂ cost of the year in cents, as printed on the supplier invoice. */
	co2Cost: number;
	/** Floor area in m² the emissions relate to: the dwelling (§ 6) or the building (statement). */
	area: number;
	use: BuildingUse;
};

export type Co2Split = {
	kgPerSquareMetre: number;
	landlordPercent: number;
	/** The landlord's share of the CO₂ cost in cents, half-up. */
	landlordAmount: number;
	tenantAmount: number;
};

/** Splits the CO₂ cost between landlord and tenant. */
export function splitCo2Cost(input: Co2SplitInput): Co2Split {
	const kgPerSquareMetre = input.area > 0 ? input.co2Kg / input.area : 0;
	const landlordPercent = landlordSharePercent(kgPerSquareMetre, input.use);
	const landlordAmount = proRata(input.co2Cost, landlordPercent, 100);
	return {
		kgPerSquareMetre,
		landlordPercent,
		landlordAmount,
		tenantAmount: input.co2Cost - landlordAmount
	};
}

/**
 * The CO₂ price of the national emissions trading (§ 10 Abs. 2 BEHG) in euros per tonne, lowest
 * and highest: a fixed price until 2025 (2023 held at 30 by the Änderungsgesetz of 2022), a price
 * corridor for the auctions of 2026. A year after 2026 is added once the law sets it.
 */
export const behgPrices: Readonly<Record<number, readonly [number, number]>> = {
	2021: [25, 25],
	2022: [30, 30],
	2023: [30, 30],
	2024: [45, 45],
	2025: [55, 55],
	2026: [55, 65]
};

/**
 * What the CO₂ of a year costs at the BEHG price, in cents without VAT: a plausibility check for
 * the CO₂ cost the supplier invoice states, which also carries the VAT and the supplier's own
 * purchase price. Null for a year without a known price or without emissions.
 */
export function behgCost(
	year: number,
	co2Kg: number
): { minPrice: number; maxPrice: number; min: number; max: number } | null {
	const prices = behgPrices[year];
	if (!prices || !(co2Kg > 0)) return null;
	const [minPrice, maxPrice] = prices;
	const cents = (price: number) => Math.round((co2Kg / 1000) * price * 100);
	return { minPrice, maxPrice, min: cents(minPrice), max: cents(maxPrice) };
}

/** The line under the CO₂ cost field: what the emissions of the year cost at the BEHG price. */
export function behgHint(year: number, co2Kg: number): string | null {
	const cost = behgCost(year, co2Kg);
	if (!cost) return null;
	const kg = `${formatNumber(co2Kg, 1)} kg`;
	if (cost.minPrice === cost.maxPrice) {
		return (
			`CO₂-Preis ${year} nach BEHG: ${cost.minPrice} € je Tonne, für ${kg} also ` +
			`${formatCents(cost.min)} ohne Umsatzsteuer.`
		);
	}
	return (
		`CO₂-Preis ${year} nach BEHG: ${cost.minPrice} bis ${cost.maxPrice} € je Tonne ` +
		`(Versteigerung), für ${kg} also ${formatCents(cost.min)} bis ${formatCents(cost.max)} ` +
		'ohne Umsatzsteuer.'
	);
}
