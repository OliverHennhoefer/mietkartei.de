import type {
	AllocationKeyKind,
	BankTransactionStatus,
	BuildingUse,
	DepositTransactionKind,
	ExpenseCategory,
	Fuel,
	HeatingCostModel,
	InsuranceKind,
	LeaseKind,
	MeterKind,
	OperatingCostModel,
	RentChangeReason,
	RentChargeKind,
	RentModel,
	StatementStatus,
	SubscriptionStatus,
	TaskCategory,
	TerminatedBy,
	UserRole
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

export const fuelLabels: Record<Fuel, string> = {
	gas: 'Erdgas',
	oil: 'Heizöl',
	lpg: 'Flüssiggas',
	district_heating: 'Fernwärme',
	other: 'Sonstiges'
};

export const rentChangeReasonLabels: Record<RentChangeReason, string> = {
	initial: 'Vertragsbeginn',
	manual: 'Änderung',
	graduated: 'Staffel',
	indexed: 'Indexanpassung',
	statement: 'Anpassung nach Abrechnung'
};

export const depositTransactionKindLabels: Record<DepositTransactionKind, string> = {
	received: 'Erhalten',
	interest: 'Zinsen',
	returned: 'Zurückgezahlt',
	withheld: 'Einbehalten'
};

export const rentChargeKindLabels: Record<RentChargeKind, string> = {
	rent: 'Miete',
	statement_balance: 'Betriebskostenabrechnung',
	co2_reimbursement: 'CO₂-Erstattung',
	adjustment: 'Korrektur'
};

export const bankTransactionStatusLabels: Record<BankTransactionStatus, string> = {
	unmatched: 'Offen',
	matched: 'Zugeordnet',
	ignored: 'Ignoriert'
};

export const allocationKeyKindLabels: Record<AllocationKeyKind, string> = {
	area: 'nach Wohnfläche',
	persons: 'nach Personen',
	units: 'nach Einheiten',
	consumption: 'nach Verbrauch',
	mixed: 'Verbrauch und Fläche',
	custom: 'eigene Anteile',
	direct: 'Beträge je Einheit (z. B. vom Messdienst)'
};

export const meterKindLabels: Record<MeterKind, string> = {
	cold_water: 'Kaltwasser',
	hot_water: 'Warmwasser',
	heat: 'Wärme',
	gas: 'Gas',
	electricity: 'Strom'
};

export const statementStatusLabels: Record<StatementStatus, string> = {
	draft: 'Entwurf',
	approved: 'Freigegeben'
};

export const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
	none: 'Kein Abo',
	trialing: 'Testphase',
	active: 'Aktiv',
	past_due: 'Zahlung ausstehend',
	canceled: 'Gekündigt'
};

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
	operating_costs: 'Betriebskosten und Hausgeld',
	maintenance: 'Instandhaltung und Reparaturen',
	financing: 'Finanzierung (Zins und Tilgung)',
	management: 'Verwaltung, Beratung und Gebühren',
	modernization: 'Modernisierung und Anschaffungen',
	other: 'Sonstiges'
};

export const insuranceKindLabels: Record<InsuranceKind, string> = {
	building: 'Wohngebäudeversicherung',
	liability: 'Haus- und Grundbesitzerhaftpflicht',
	glass: 'Glasversicherung',
	oil_tank: 'Gewässerschadenhaftpflicht',
	rent_loss: 'Mietausfallversicherung',
	legal: 'Vermieterrechtsschutz',
	other: 'Sonstige Versicherung'
};

export const taskCategoryLabels: Record<TaskCategory, string> = {
	maintenance: 'Wartung',
	inspection: 'Prüfung',
	insurance: 'Versicherung',
	other: 'Sonstiges'
};

export const userRoleLabels: Record<UserRole, string> = {
	owner: 'Vermieter',
	manager: 'Mitverwalter'
};

/** The verbs of the audit log (AuditAction in schema.ts), for /einstellungen/protokoll. */
export const auditActionLabels: Record<string, string> = {
	create: 'Angelegt',
	update: 'Geändert',
	delete: 'Gelöscht',
	approve: 'Freigegeben',
	correct: 'Korrigiert',
	import: 'Importiert',
	invite: 'Eingeladen',
	post: 'Gebucht',
	assign: 'Zugeordnet',
	undo: 'Rückgängig gemacht',
	ignore: 'Ignoriert',
	upload: 'Hochgeladen',
	reset: 'Zurückgesetzt',
	export: 'Exportiert'
};

/** The entities of the audit log, as the features name them, for /einstellungen/protokoll. */
export const auditEntityLabels: Record<string, string> = {
	account: 'Konto',
	user: 'Zugang',
	invitation: 'Einladung',
	api_key: 'API-Schlüssel',
	property: 'Objekt',
	unit: 'Einheit',
	tenant: 'Mieter',
	lease: 'Mietvertrag',
	bankAccount: 'Bankverbindung',
	bankImport: 'Bankimport',
	bankTransaction: 'Umsatz',
	matchingRule: 'Zuordnungsregel',
	cost_category: 'Kostenart',
	allocation_key: 'Umlageschlüssel',
	billing_circle: 'Abrechnungskreis',
	cost_item: 'Beleg',
	meter: 'Zähler',
	insurance_policy: 'Versicherung',
	calendar_feed: 'Kalender-Link',
	meter_reading: 'Zählerstand',
	statement: 'Betriebskostenabrechnung',
	document: 'Dokument',
	task: 'Aufgabe',
	expense: 'Ausgabe',
	vpi: 'Verbraucherpreisindex',
	import: 'Datenübernahme'
};
