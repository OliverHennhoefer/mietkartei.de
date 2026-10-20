import { proRata } from '../money';

// Kohlendioxidkostenaufteilungsgesetz (CO2KostAufG): the landlord bears a share of the CO₂ cost of
// heating that grows with the building's emissions per square metre. Two cases use this file: the
// statement (landlord buys the fuel, § 5–7) and the stand-alone split for a tenant with an own fuel
// contract (§ 6), see PROTOTYPE.md "CO₂ cost split".

export type BuildingUse = 'residential' | 'non_residential';

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
export const NON_RESIDENTIAL_LANDLORD_PERCENT = 50;

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
export const emissionFactors: Record<string, number | undefined> = {
	gas: 0.201,
	oil: 0.266,
	lpg: 0.234
};

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
