import type {
	BuildingUse,
	DepositTransactionKind,
	HeatingCostModel,
	LeaseKind,
	OperatingCostModel,
	RentChargeKind,
	RentModel,
	TerminatedBy
} from './server/db/schema';

// German labels for the enums in the schema, so every page uses the same words.

export const leaseKindLabels: Record<LeaseKind, string> = {
	residential: 'Wohnraum',
	commercial: 'Gewerbe (ohne Umsatzsteuer)',
	parking: 'Stellplatz'
};

export const rentModelLabels: Record<RentModel, string> = {
	fixed: 'Feste Miete',
	graduated: 'Staffelmiete',
	indexed: 'Indexmiete'
};

export const operatingCostModelLabels: Record<OperatingCostModel, string> = {
	prepayment: 'Vorauszahlung (wird abgerechnet)',
	flat: 'Pauschale (wird nicht abgerechnet)',
	inclusive: 'In der Miete enthalten'
};

export const heatingCostModelLabels: Record<HeatingCostModel, string> = {
	prepayment: 'Vorauszahlung (wird abgerechnet)',
	flat: 'Pauschale (wird nicht abgerechnet)'
};

export const terminatedByLabels: Record<TerminatedBy, string> = {
	tenant: 'durch Mieter',
	landlord: 'durch Vermieter'
};

export const buildingUseLabels: Record<BuildingUse, string> = {
	residential: 'Wohngebäude',
	non_residential: 'Nichtwohngebäude'
};

export const depositTransactionKindLabels: Record<DepositTransactionKind, string> = {
	received: 'Erhalten',
	interest: 'Zinsen',
	returned: 'Zurückgezahlt',
	withheld: 'Einbehalten'
};

export const rentChargeKindLabels: Record<RentChargeKind, string> = {
	rent: 'Miete',
	adjustment: 'Korrektur'
};
