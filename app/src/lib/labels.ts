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
	PropertyKind,
	RentChangeReason,
	RentChargeKind,
	RentModel,
	StatementStatus,
	SubscriptionStatus,
	TaskCategory,
	TerminatedBy,
	UserRole
} from './server/db/schema';
import type { GermanState } from './working-days';

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

export const propertyKindLabels: Record<PropertyKind, string> = {
	building: 'Gebäude (eigene Abrechnung)',
	condominium: 'Eigentumswohnung in einer WEG'
};

export const buildingUseLabels: Record<BuildingUse, string> = {
	residential: 'Wohngebäude',
	non_residential: 'Nichtwohngebäude'
};

export const stateLabels: Record<GermanState, string> = {
	BW: 'Baden-Württemberg',
	BY: 'Bayern',
	BE: 'Berlin',
	BB: 'Brandenburg',
	HB: 'Bremen',
	HH: 'Hamburg',
	HE: 'Hessen',
	MV: 'Mecklenburg-Vorpommern',
	NI: 'Niedersachsen',
	NW: 'Nordrhein-Westfalen',
	RP: 'Rheinland-Pfalz',
	SL: 'Saarland',
	SN: 'Sachsen',
	ST: 'Sachsen-Anhalt',
	SH: 'Schleswig-Holstein',
	TH: 'Thüringen'
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
	operating_costs: 'Betriebskosten',
	association_fee: 'Hausgeld (WEG)',
	special_levy: 'Sonderumlage für Erhaltung (WEG)',
	special_levy_reserve: 'Sonderumlage in die Rücklage (WEG)',
	maintenance: 'Instandhaltung und Reparaturen',
	loan_payment: 'Darlehensrate (Zins und Tilgung)',
	loan_interest: 'Darlehenszinsen',
	loan_repayment: 'Tilgung',
	management: 'Verwaltung, Beratung und Gebühren',
	modernization: 'Modernisierung und Anschaffungen',
	other: 'Sonstiges'
};

/** One or two words per category, for tight spots such as the pills on /auswertung. */
export const expenseCategoryShortLabels: Record<ExpenseCategory, string> = {
	operating_costs: 'Betriebskosten',
	association_fee: 'Hausgeld',
	special_levy: 'Sonderumlage',
	special_levy_reserve: 'Rücklage',
	maintenance: 'Instandhaltung',
	loan_payment: 'Darlehensrate',
	loan_interest: 'Zinsen',
	loan_repayment: 'Tilgung',
	management: 'Verwaltung',
	modernization: 'Modernisierung',
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
	manager: 'Mitverwalter',
	viewer: 'Lesezugriff'
};

/** The role in a sentence: „… arbeitet als Mitverwalter mit“, „… ist jetzt mit Lesezugriff dabei“. */
export const userRolePhrases: Record<UserRole, string> = {
	owner: 'als Vermieter',
	manager: 'als Mitverwalter',
	viewer: 'mit Lesezugriff'
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
	association_statement: 'Hausgeldabrechnung',
	tax_year: 'Steuerjahr',
	calendar_feed: 'Kalender-Link',
	meter_reading: 'Zählerstand',
	statement: 'Betriebskostenabrechnung',
	document: 'Dokument',
	task: 'Aufgabe',
	expense: 'Ausgabe',
	import: 'Datenübernahme'
};
