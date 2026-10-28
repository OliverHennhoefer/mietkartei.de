import { and, count, eq, inArray, isNull, sql, type Table } from 'drizzle-orm';
import {
	addDays,
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	formatDate,
	lastOfMonth,
	monthOf,
	monthsInRange,
	today,
	type IsoDate,
	type IsoMonth
} from '../dates';
import { fingerprintRows, formatIban, type BankRow } from '../domain/bank-matching';
import { co2KgFromKwh } from '../domain/co2';
import {
	cappingBase,
	comparativeEffectiveFrom,
	comparativeLetterRows,
	comparativeLetterText,
	type ComparativeDemand
} from '../domain/comparative-rent';
import { effectiveFrom } from '../domain/index-rent';
import { monthlyAmounts, total, type RentChange } from '../domain/rents';
import { formatCents } from '../money';
import type { UnitKind } from '../units';
import { nthWorkingDay, type GermanState } from '../working-days';
import { addressLines, landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import { createCo2Split } from './co2';
import { addressKey } from './geocoding';
import type { Database } from './db';
import { chunk, chunkIds, rowsPerStatement, runBatch } from './db/batch';
import {
	associationStatements,
	auditLog,
	bankAccounts,
	bankTransactions,
	costItems,
	costItemUnitAmounts,
	depositTransactions,
	expenses,
	insurancePolicies,
	leasePersons,
	leases,
	matchingRules,
	meterReadings,
	meters,
	operatingCostStatements,
	payments,
	properties,
	rentChanges,
	rentCharges,
	statementResults,
	tasks,
	taxYears,
	tenants,
	units,
	type ExpenseCategory,
	type RentChangeReason
} from './db/schema';
import { signedDepositAmount } from './deposits';
import { deleteDocument, storeDocument } from './documents';
import { newLeaseStatements, type LeaseInput } from './leases';
import { ensureDefaults, listCategories, listKeys } from './operating-costs';
import { assertQuota, type QuotaKind } from './quotas';
import { renderLetter } from './pdf';
import { postCharge } from './ledger';
import { createReminder, reminderLetter, updateReminderText } from './reminders';
import { approveStatement, DUE_DAYS } from './statements';
import type { Storage } from './storage';
import type { TenantInput } from './tenants';

// Demo data for an empty account: a small portfolio that touches every feature with as few rows
// as it takes, but with eight years of history, so the Auswertung, the tax overview and the tenant
// dossiers have something to show. A Mehrfamilienhaus in Berlin (three flats and a parking space,
// central gas heating with heat meters) and two Eigentumswohnungen in a WEG, in Potsdam and in
// Munich, with their Hausgeld and the Verwalter's Hausgeldabrechnungen. Eleven leases: a fixed rent
// with a rise to the Mietspiegel, an index rent, a Staffelmiete, one two months in arrears with a
// Zahlungserinnerung and a Mahnung, and a tenant change in the history of every flat, the former
// tenants archived with their new address and their deposit settled. The next change is under way:
// the tenant in Potsdam gave notice this month, and the new tenant's lease starts after it. The properties carry their
// position, so the map shows them without asking the geocoder. Values follow German averages of the years (Kaltmiete per m²,
// Betriebskosten, gas prices, CO₂ price, interest rates); they are made up, but plausible.
//
// Dates are relative to the current year, so the demo never ages. Price tables are keyed by the
// calendar year they describe and fall back to the nearest year they know.
//
// The rows are written in one batch, with the audit lines the features' own functions write, so
// a failure leaves the account empty. The operating cost statements of past years, the letters to
// the tenant in arrears and the CO₂ split are then made by the features' own functions, as a
// landlord would have made them on their day. Nothing marks the rows as demo rows; the landlord
// deletes them with the reset to factory settings (Einstellungen → Konto).

export type DemoResult = { ok: true; leases: number } | { ok: false; reason: 'not-empty' };

/** Years of history before the current one, from 1 January. */
const HISTORY_YEARS = 8;

// Price tables by calendar year, from 2018 on.

/** Erdgas for a small building, cents per kWh gross. */
const GAS_PRICE: Record<number, number> = {
	2018: 6.1,
	2019: 6.3,
	2020: 6.4,
	2021: 6.8,
	2022: 11.9,
	2023: 13.4,
	2024: 11.2,
	2025: 10.6,
	2026: 10.2
};
/** Gas the Mehrfamilienhaus used, kWh (weather and the savings of 2022). */
const GAS_KWH: Record<number, number> = {
	2018: 31_200,
	2019: 32_900,
	2020: 32_400,
	2021: 31_800,
	2022: 27_900,
	2023: 28_600,
	2024: 27_400,
	2025: 29_100,
	2026: 28_800
};
/** Prices of services and supplies against 2021. */
const COST_INDEX: Record<number, number> = {
	2018: 0.95,
	2019: 0.97,
	2020: 0.98,
	2021: 1,
	2022: 1.05,
	2023: 1.11,
	2024: 1.15,
	2025: 1.18,
	2026: 1.21
};
/** CO₂ price under the BEHG, euro per tonne. */
const CO2_PRICE: Record<number, number> = { 2023: 30, 2024: 45, 2025: 55, 2026: 60 };
/** Verbraucherpreisindex (2020 = 100) in September. */
const VPI_SEPTEMBER: Record<number, number> = {
	2018: 98.4,
	2019: 99.9,
	2020: 99.6,
	2021: 103.2,
	2022: 112.7,
	2023: 117.8,
	2024: 119.7,
	2025: 122.6,
	2026: 124.9
};
/** Interest on a Mietkautionskonto, percent per year. */
const DEPOSIT_RATE: Record<number, number> = {
	2018: 0.01,
	2019: 0.01,
	2020: 0.01,
	2021: 0.01,
	2022: 0.05,
	2023: 0.75,
	2024: 1.25,
	2025: 0.9,
	2026: 0.75
};
/** Premium of the Wohngebäudeversicherung for the insurance year starting in the year, cents. */
const BUILDING_PREMIUM: Record<number, number> = {
	2018: 89_000,
	2019: 93_000,
	2020: 98_000,
	2021: 104_000,
	2022: 112_000,
	2023: 128_000,
	2024: 141_000,
	2025: 149_000,
	2026: 155_000
};

/** The table's value for the year, or the nearest year's when the table does not reach it. */
function byYear(table: Record<number, number>, year: number): number {
	if (table[year] !== undefined) return table[year];
	const years = Object.keys(table).map(Number);
	const nearest = year < Math.min(...years) ? Math.min(...years) : Math.max(...years);
	// Beyond the table prices keep rising by 2 % a year.
	return table[nearest] * 1.02 ** Math.max(0, year - nearest);
}

function tenant(
	salutation: string,
	firstName: string,
	lastName: string,
	email: string | null,
	phone: string | null = null,
	/** The new address of a tenant who moved out; a current tenant gets letters at the unit. */
	address: [street: string, postalCode: string, city: string] | null = null
): TenantInput {
	return {
		salutation,
		firstName,
		lastName,
		email,
		phone,
		street: address?.[0] ?? null,
		postalCode: address?.[1] ?? null,
		city: address?.[2] ?? null,
		notes: null
	};
}

function lease(unitId: string, tenantIds: string[], overrides: Partial<LeaseInput>): LeaseInput {
	return {
		unitId,
		extraUnitIds: [],
		tenantIds,
		startDate: '2024-01-01',
		endDate: null,
		kind: 'residential',
		rentModel: 'fixed',
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		baseRent: 65000,
		operatingCostPrepayment: 14000,
		heatingCostPrepayment: 6000,
		securityDeposit: 195000,
		persons: 2,
		rentDueDay: 3,
		ledgerStart: null,
		indexBaseMonth: null,
		indexBaseValue: null,
		indexBaseYear: '2020',
		terminatedAt: null,
		terminatedBy: null,
		notes: null,
		...overrides
	};
}

/** A change of the rent after the initial one; amounts left out stay as they were. */
type DemoRentChange = {
	validFrom: IsoDate;
	reason: Exclude<RentChangeReason, 'initial'>;
	baseRent?: number;
	operatingCostPrepayment?: number;
	heatingCostPrepayment?: number;
	note?: string;
	indexMonth?: IsoMonth;
	indexValue?: number;
	deliveredOn?: IsoDate;
	/** A § 558 increase: the Mietspiegel and its field the Vergleichsmiete comes from. */
	comparison?: DemoComparison;
};

type DemoComparison = { index: string; field: string };

/** An annuity loan: the monthly rate and its interest, booked from the month after acquisition. */
type Loan = { principal: number; ratePercent: number; payment: number; lender: string };

/** The interest of each calendar year of the loan, paid at the end of each month. */
function loanInterestByYear(loan: Loan, firstMonth: IsoMonth, lastMonth: IsoMonth) {
	const interest = new Map<number, number>();
	let balance = loan.principal;
	for (const month of monthsInRange(firstMonth, lastMonth)) {
		const part = Math.round((balance * loan.ratePercent) / 100 / 12);
		balance -= loan.payment - part;
		const year = Number(month.slice(0, 4));
		interest.set(year, (interest.get(year) ?? 0) + part);
	}
	return interest;
}

/** Rounds up to whole 5 euros, as a Wirtschaftsplan sets the Hausgeld. */
const ceilToFive = (amount: number) => Math.ceil(amount / 500) * 500;

/** Whether the account holds no property yet; the demo button is only offered then. */
export async function isEmptyAccount(db: Database, accountId: string): Promise<boolean> {
	const [row] = await db
		.select({ count: count() })
		.from(properties)
		.where(eq(properties.accountId, accountId));
	return row.count === 0;
}

export async function createDemoData(
	db: Database,
	context: AuditContext,
	options?: { storage?: Storage }
): Promise<DemoResult> {
	const { accountId } = context;
	if (!(await isEmptyAccount(db, accountId))) return { ok: false, reason: 'not-empty' };
	const date = today();
	const Y = Number(date.slice(0, 4));
	/** A day in the year `offset` years from now, e.g. at(-2, '05-12'). */
	const at = (offset: number, monthDay: string): IsoDate => `${Y + offset}-${monthDay}`;
	const currentMonth = monthOf(date);
	const lastMonth = addMonthsToMonth(currentMonth, -1);
	const firstYear = Y - HISTORY_YEARS;
	const firstBookedMonth = `${firstYear}-01`;
	const historyYears = Array.from({ length: HISTORY_YEARS }, (_, index) => firstYear + index);
	/** This month's bookings happen by today at the latest, whatever day of the month it is. */
	const soFar = (day: IsoDate) => (day < date ? day : date);

	// Reads and idempotent seeding first; everything else is written in one batch below, so a
	// failure leaves the account empty and the button offers the demo again.
	await ensureDefaults(db, accountId);
	const categories = await listCategories(db, accountId);
	const keys = await listKeys(db, accountId);
	const categoryId = (name: string) => categories.find((row) => row.name === name)!.id;
	const keyId = (name: string) => keys.find((row) => row.name === name)!.id;
	const defaultKeyId = (category: string) =>
		categories.find((row) => row.name === category)?.allocationKeyId ?? keyId('Wohnfläche');

	// Properties and units.
	const lindenId = crypto.randomUUID();
	const parkId = crypto.randomUUID();
	const rosenheimId = crypto.randomUUID();
	const stateOf: Record<string, GermanState> = {
		[lindenId]: 'BE',
		[parkId]: 'BB',
		[rosenheimId]: 'BY'
	};
	const acquisition = {
		[lindenId]: at(-12, '03-01'),
		[parkId]: at(-11, '04-01'),
		[rosenheimId]: at(-9, '10-01')
	};
	const propertyRows = [
		{
			id: lindenId,
			accountId,
			name: 'Lindenstraße 12',
			street: 'Lindenstraße 12',
			postalCode: '10969',
			city: 'Berlin',
			kind: 'building' as const,
			state: 'BE' as const,
			acquisitionDate: acquisition[lindenId],
			// 640.000 € plus Grunderwerbsteuer, Notar, Grundbuch and Makler.
			acquisitionCost: 736_000_00,
			// The principal of the loans booked below.
			loanAmount: 520_000_00,
			buildingShare: 70,
			// Built 1906: 2.5 % (§ 7 Abs. 4 Nr. 2 b EStG).
			depreciationRate: 2.5,
			notes: 'Altbau von 1906, Zentralheizung Gas, Wärmemengenzähler je Wohnung.',
			latitude: 52.50215,
			longitude: 13.39508
		},
		{
			id: parkId,
			accountId,
			name: 'Parkallee 8, Wohnung 14',
			street: 'Parkallee 8',
			postalCode: '14469',
			city: 'Potsdam',
			kind: 'condominium' as const,
			associationManager: 'Havelland Hausverwaltung GmbH',
			ownershipShare: 71.3,
			ownershipShareTotal: 1000,
			state: 'BB' as const,
			acquisitionDate: acquisition[parkId],
			acquisitionCost: 274_400_00,
			loanAmount: 200_000_00,
			buildingShare: 80,
			depreciationRate: 2,
			notes: 'WEG mit 14 Einheiten, Baujahr 1996, Aufzug, Zentralheizung.',
			latitude: 52.41372,
			longitude: 13.04466
		},
		{
			id: rosenheimId,
			accountId,
			name: 'Rosenheimer Straße 104, Wohnung 9',
			street: 'Rosenheimer Straße 104',
			postalCode: '81669',
			city: 'München',
			kind: 'condominium' as const,
			associationManager: 'Isar Immobilienverwaltung KG',
			ownershipShare: 48.6,
			ownershipShareTotal: 1000,
			state: 'BY' as const,
			acquisitionDate: acquisition[rosenheimId],
			acquisitionCost: 471_300_00,
			loanAmount: 380_000_00,
			buildingShare: 45,
			depreciationRate: 2,
			notes: 'WEG mit 21 Einheiten, Baujahr 1972, Gasetagenheizung je Wohnung.',
			latitude: 48.12384,
			longitude: 11.60036
		}
	].map((row) => ({ ...row, geocodedAddress: addressKey(row) }));
	const unitRows = [
		{
			propertyId: lindenId,
			name: 'Wohnung EG links',
			kind: 'apartment',
			floorArea: 62,
			floor: 'EG',
			rooms: 2
		},
		{
			propertyId: lindenId,
			name: 'Wohnung EG rechts',
			kind: 'apartment',
			floorArea: 58,
			floor: 'EG',
			rooms: 2
		},
		{
			propertyId: lindenId,
			name: 'Wohnung 1. OG',
			kind: 'apartment',
			floorArea: 76,
			floor: '1. OG',
			rooms: 3
		},
		{
			propertyId: lindenId,
			name: 'Stellplatz 1',
			kind: 'parking',
			floorArea: null,
			floor: null,
			rooms: null
		},
		{
			propertyId: parkId,
			name: 'Wohnung 14',
			kind: 'apartment',
			floorArea: 68,
			floor: '3. OG',
			rooms: 3
		},
		{
			propertyId: rosenheimId,
			name: 'Wohnung 9',
			kind: 'apartment',
			floorArea: 54,
			floor: '2. OG',
			rooms: 2
		}
	].map((row) => ({ id: crypto.randomUUID(), accountId, ...row, kind: row.kind as UnitKind }));
	const unitId = (name: string) => unitRows.find((row) => row.name === name)!.id;
	const unitOf = (id: string) => unitRows.find((row) => row.id === id)!;

	// Tenants. Those who moved out are archived, with the address they moved to.
	const tenantInputs = {
		schmidt: tenant('Frau', 'Anna', 'Schmidt', 'anna.schmidt@example.org', '0170 2345678'),
		kraus: tenant('Frau', 'Helga', 'Kraus', null, '030 6912345', [
			'Wilhelmsaue 41',
			'10713',
			'Berlin'
		]),
		hartmann: tenant('Herr', 'Peter', 'Hartmann', 'p.hartmann@example.org', null, [
			'Karl-Liebknecht-Straße 18',
			'04107',
			'Leipzig'
		]),
		dieterSchulze: tenant('Herr', 'Dieter', 'Schulze', 'schulze.familie@example.org', null, [
			'Am Gutspark 7',
			'14612',
			'Falkensee'
		]),
		monikaSchulze: tenant('Frau', 'Monika', 'Schulze', null, '030 7854120', [
			'Am Gutspark 7',
			'14612',
			'Falkensee'
		]),
		lorenz: tenant('Frau', 'Sabine', 'Lorenz', 'sabine.lorenz@example.org', null, [
			'Brandenburger Straße 31',
			'14467',
			'Potsdam'
		]),
		fischer: tenant('Herr', 'Markus', 'Fischer', 'markus.fischer@example.org', '0176 4410982', [
			'Eppendorfer Weg 140',
			'20253',
			'Hamburg'
		]),
		yilmaz: tenant('Herr', 'Murat', 'Yılmaz', 'murat.yilmaz@example.org'),
		berger: tenant('Frau', 'Lena', 'Berger', 'lena.berger@example.org', '0151 9876543'),
		nowak: tenant('Herr', 'Tomasz', 'Nowak', 'tomasz.nowak@example.org'),
		weber: tenant('Frau', 'Julia', 'Weber', 'julia.weber@example.org'),
		albrecht: tenant('Herr', 'Jonas', 'Albrecht', 'jonas.albrecht@example.org'),
		krueger: tenant('Frau', 'Miriam', 'Krüger', 'miriam.krueger@example.org', '0160 3318274')
	};
	const archived: Partial<Record<keyof typeof tenantInputs, IsoDate>> = {
		kraus: at(-4, '12-01'),
		hartmann: at(-6, '07-01'),
		dieterSchulze: at(-7, '03-01'),
		monikaSchulze: at(-7, '03-01'),
		lorenz: at(-7, '06-01'),
		fischer: at(-5, '01-15')
	};
	const tenantRows = Object.entries(tenantInputs).map(([key, input]) => ({
		id: crypto.randomUUID(),
		accountId,
		...input,
		archivedAt: archived[key as keyof typeof tenantInputs] ?? null
	}));
	const tenantIds = Object.fromEntries(
		Object.keys(tenantInputs).map((key, index) => [key, tenantRows[index].id])
	) as Record<keyof typeof tenantInputs, string>;

	// Leases with their rent history. Nowak gave notice early this month (by the third working day,
	// § 573c BGB), so the lease ends with the second month after it; Krüger moves in the day after.
	const noticeDay = soFar(nthWorkingDay(currentMonth, 2, 'BB'));
	const moveOutDay = lastOfMonth(addMonthsToMonth(currentMonth, 2));
	const vpi = (year: number) => Math.round(byYear(VPI_SEPTEMBER, year) * 10) / 10;
	const indexed = (base: number, from: number, to: number) =>
		Math.round((base * vpi(to)) / vpi(from));
	const yilmazBase = 69000;
	const yilmazFirst = indexed(yilmazBase, Y - 4, Y - 3);
	const yilmazSecond = indexed(yilmazFirst, Y - 3, Y - 1);
	const staffel = (step: number) => 92900 + 2300 * step;
	const plans: {
		key: string;
		state: GermanState;
		input: LeaseInput;
		changes: DemoRentChange[];
		/** Months left unpaid at the end: the arrears. */
		unpaidMonths?: number;
		/** An ended lease: the deposit paid back that day, less what was withheld and why. */
		moveOut?: { day: IsoDate; withheld?: [amount: number, note: string] };
		/** A § 558 demand the tenant has not consented to yet. */
		demand?: { deliveredOn: IsoDate; baseRent: number; comparison: DemoComparison };
		/** Who the rent comes from, as the bank shows it; only for leases paying on the bank account. */
		bank?: { payer: string; iban: string; purpose: (month: IsoMonth) => string };
	}[] = [
		{
			key: 'kraus',
			state: 'BE',
			input: lease(unitId('Wohnung EG rechts'), [tenantIds.kraus], {
				startDate: '2012-09-01',
				endDate: at(-4, '08-31'),
				baseRent: 45800,
				operatingCostPrepayment: 11000,
				heatingCostPrepayment: 6500,
				securityDeposit: 137400,
				persons: 1,
				terminatedAt: at(-4, '05-27'),
				terminatedBy: 'tenant',
				notes: 'Ausgezogen ins betreute Wohnen.'
			}),
			changes: [
				{
					validFrom: at(-6, '03-01'),
					reason: 'comparative',
					baseRent: 52200,
					comparison: { index: 'Berliner Mietspiegel', field: 'Feld E3' }
				}
			],
			moveOut: {
				day: at(-4, '10-20'),
				withheld: [38000, 'Einbehalt: Reparatur Badtür und Herd laut Abnahmeprotokoll']
			}
		},
		{
			key: 'hartmann',
			state: 'BE',
			input: lease(unitId('Wohnung EG links'), [tenantIds.hartmann], {
				startDate: at(-15, '06-01'),
				endDate: at(-6, '03-31'),
				baseRent: 41000,
				operatingCostPrepayment: 10500,
				heatingCostPrepayment: 6000,
				securityDeposit: 123000,
				persons: 2,
				terminatedAt: at(-7, '12-20'),
				terminatedBy: 'tenant',
				notes: 'Beruflich nach Leipzig gezogen.'
			}),
			changes: [
				{
					validFrom: at(-9, '05-01'),
					reason: 'comparative',
					baseRent: 47100,
					comparison: { index: 'Berliner Mietspiegel', field: 'Feld E3' }
				}
			],
			moveOut: { day: at(-6, '05-18') }
		},
		{
			key: 'schulze',
			state: 'BE',
			input: lease(unitId('Wohnung 1. OG'), [tenantIds.dieterSchulze, tenantIds.monikaSchulze], {
				extraUnitIds: [unitId('Stellplatz 1')],
				startDate: at(-21, '05-01'),
				endDate: at(-8, '12-31'),
				baseRent: 61000,
				operatingCostPrepayment: 15000,
				heatingCostPrepayment: 8500,
				securityDeposit: 165000,
				persons: 3,
				terminatedAt: at(-8, '09-25'),
				terminatedBy: 'tenant',
				notes: 'Ins eigene Haus in Falkensee gezogen. Kaltmiete inklusive Stellplatz.'
			}),
			changes: [
				{
					validFrom: at(-10, '04-01'),
					reason: 'comparative',
					baseRent: 68500,
					comparison: { index: 'Berliner Mietspiegel', field: 'Feld E3' }
				}
			],
			moveOut: {
				day: at(-7, '02-20'),
				withheld: [25000, 'Einbehalt: Schönheitsreparaturen Küche laut Abnahmeprotokoll']
			}
		},
		{
			key: 'lorenz',
			state: 'BB',
			input: lease(unitId('Wohnung 14'), [tenantIds.lorenz], {
				startDate: at(-13, '08-01'),
				endDate: at(-7, '03-31'),
				baseRent: 52000,
				operatingCostPrepayment: 14000,
				heatingCostPrepayment: 9000,
				securityDeposit: 156000,
				persons: 1,
				terminatedAt: at(-8, '12-28'),
				terminatedBy: 'tenant',
				notes: 'Vom Voreigentümer übernommen.'
			}),
			changes: [
				{
					validFrom: at(-9, '08-01'),
					reason: 'comparative',
					baseRent: 58500,
					comparison: {
						index: 'Mietspiegel der Landeshauptstadt Potsdam',
						field: 'Spalte 3, Zeile 5'
					}
				}
			],
			moveOut: { day: at(-7, '05-27') }
		},
		{
			key: 'fischer',
			state: 'BY',
			input: lease(unitId('Wohnung 9'), [tenantIds.fischer], {
				startDate: at(-12, '02-01'),
				endDate: at(-6, '10-31'),
				baseRent: 76000,
				operatingCostPrepayment: 11000,
				heatingCostPrepayment: 0,
				securityDeposit: 228000,
				persons: 1,
				terminatedAt: at(-6, '07-30'),
				terminatedBy: 'tenant',
				notes: 'Vom Voreigentümer übernommen. Eigener Gasvertrag für die Etagenheizung.'
			}),
			changes: [
				{
					validFrom: at(-8, '03-01'),
					reason: 'comparative',
					baseRent: 84500,
					comparison: { index: 'Mietspiegel für München', field: 'Wohnlage gut, Baujahr bis 1949' }
				}
			],
			moveOut: {
				day: at(-6, '12-14'),
				withheld: [42000, 'Einbehalt: Bohrlöcher im Bad und fehlender Kellerschlüssel']
			}
		},

		{
			key: 'schmidt',
			state: 'BE',
			input: lease(unitId('Wohnung EG links'), [tenantIds.schmidt], {
				startDate: at(-6, '04-01'),
				baseRent: 69400,
				operatingCostPrepayment: 13000,
				heatingCostPrepayment: 7000,
				securityDeposit: 208200,
				persons: 2
			}),
			changes: [
				{
					validFrom: at(-3, '08-01'),
					reason: 'comparative',
					baseRent: 76000,
					comparison: { index: 'Berliner Mietspiegel', field: 'Feld E3' }
				},
				{
					validFrom: at(-2, '07-01'),
					reason: 'statement',
					operatingCostPrepayment: 13500,
					heatingCostPrepayment: 10500
				},
				{ validFrom: at(-1, '07-01'), reason: 'statement', heatingCostPrepayment: 9500 }
			],
			demand: {
				deliveredOn: addDays(date, -20),
				baseRent: 82500,
				comparison: { index: 'Berliner Mietspiegel', field: 'Feld E3' }
			},
			bank: {
				payer: 'Anna Schmidt',
				iban: 'DE80100500001062734591',
				purpose: (month) => `Miete ${month} Lindenstr. 12 EG links`
			}
		},
		{
			key: 'yilmaz',
			state: 'BE',
			input: lease(unitId('Wohnung EG rechts'), [tenantIds.yilmaz], {
				startDate: at(-4, '10-01'),
				rentModel: 'indexed',
				indexBaseMonth: `${Y - 4}-09`,
				indexBaseValue: vpi(Y - 4),
				baseRent: yilmazBase,
				operatingCostPrepayment: 12500,
				heatingCostPrepayment: 8500,
				securityDeposit: 207000,
				persons: 1
			}),
			changes: [
				{
					validFrom: effectiveFrom(at(-3, '10-16')),
					deliveredOn: at(-3, '10-16'),
					reason: 'indexed',
					baseRent: yilmazFirst,
					indexMonth: `${Y - 3}-09`,
					indexValue: vpi(Y - 3)
				},
				{ validFrom: at(-2, '07-01'), reason: 'statement', heatingCostPrepayment: 10000 },
				{
					validFrom: at(-1, '07-01'),
					reason: 'statement',
					operatingCostPrepayment: 13000,
					heatingCostPrepayment: 9000
				},
				{
					validFrom: effectiveFrom(at(-1, '10-14')),
					deliveredOn: at(-1, '10-14'),
					reason: 'indexed',
					baseRent: yilmazSecond,
					indexMonth: `${Y - 1}-09`,
					indexValue: vpi(Y - 1)
				}
			],
			bank: {
				payer: 'Murat Yilmaz',
				iban: 'DE11120300001027384650',
				purpose: () => 'Miete EG rechts'
			}
		},
		{
			key: 'berger',
			state: 'BE',
			input: lease(unitId('Wohnung 1. OG'), [tenantIds.berger], {
				extraUnitIds: [unitId('Stellplatz 1')],
				startDate: at(-7, '01-01'),
				baseRent: 84800,
				operatingCostPrepayment: 16000,
				heatingCostPrepayment: 9000,
				securityDeposit: 254400,
				persons: 3,
				notes: 'Kaltmiete inklusive 50 € für den Stellplatz.'
			}),
			changes: [
				{
					validFrom: at(-4, '06-01'),
					reason: 'comparative',
					baseRent: 92000,
					comparison: { index: 'Berliner Mietspiegel', field: 'Feld E3' }
				},
				{
					validFrom: at(-2, '07-01'),
					reason: 'statement',
					operatingCostPrepayment: 16500,
					heatingCostPrepayment: 13500
				},
				{ validFrom: at(-1, '07-01'), reason: 'statement', heatingCostPrepayment: 12500 }
			],
			unpaidMonths: 2,
			bank: {
				payer: 'Lena Berger',
				iban: 'DE18100700240584221300',
				purpose: (month) => `Miete ${month} Berger 1.OG + Stellplatz`
			}
		},
		{
			key: 'nowak',
			state: 'BB',
			input: lease(unitId('Wohnung 14'), [tenantIds.nowak], {
				startDate: at(-7, '05-01'),
				endDate: moveOutDay,
				baseRent: 66600,
				operatingCostPrepayment: 15000,
				heatingCostPrepayment: 10000,
				securityDeposit: 199800,
				persons: 2,
				terminatedAt: noticeDay,
				terminatedBy: 'tenant',
				notes: 'Gekündigt: Jobwechsel nach Hamburg.'
			}),
			changes: [
				{
					validFrom: at(-3, '05-01'),
					reason: 'comparative',
					baseRent: 73500,
					comparison: {
						index: 'Mietspiegel der Landeshauptstadt Potsdam',
						field: 'Spalte 3, Zeile 5'
					}
				},
				{ validFrom: at(-2, '08-01'), reason: 'statement', heatingCostPrepayment: 15000 },
				{ validFrom: at(-1, '08-01'), reason: 'statement', operatingCostPrepayment: 16000 }
			],
			bank: {
				payer: 'Tomasz Nowak',
				iban: 'DE54500105175419038277',
				purpose: (month) => `Miete ${month} Parkallee 8 Whg 14`
			}
		},
		{
			key: 'weber',
			state: 'BY',
			input: lease(unitId('Wohnung 9'), [tenantIds.weber, tenantIds.albrecht], {
				startDate: at(-6, '12-01'),
				rentModel: 'graduated',
				baseRent: staffel(0),
				operatingCostPrepayment: 12000,
				// Gasetagenheizung: the tenants have their own gas contract.
				heatingCostPrepayment: 0,
				securityDeposit: 278700,
				persons: 2,
				notes: 'Staffelmiete, jährlich zum 1. Dezember. Eigener Gasvertrag für die Etagenheizung.'
			}),
			changes: [
				...[1, 2, 3, 4, 5, 6].map((step) => ({
					validFrom: at(-6 + step, '12-01'),
					reason: 'graduated' as const,
					baseRent: staffel(step)
				})),
				{ validFrom: at(-1, '08-01'), reason: 'statement', operatingCostPrepayment: 13000 }
			],
			bank: {
				payer: 'Julia Weber',
				iban: 'DE36120300001044198277',
				purpose: (month) => `Miete ${month} Rosenheimer Str 104 WE 9 Weber/Albrecht`
			}
		},
		{
			key: 'krueger',
			state: 'BB',
			input: lease(unitId('Wohnung 14'), [tenantIds.krueger], {
				startDate: addDays(moveOutDay, 1),
				baseRent: 81500,
				operatingCostPrepayment: 16000,
				heatingCostPrepayment: 14000,
				securityDeposit: 244500,
				persons: 1,
				notes: 'Neuvermietung nach Herrn Nowak; Übergabe am Tag nach seinem Auszug.'
			}),
			changes: []
		}
	];
	// Only the history years are booked: an older lease starts its ledger there.
	for (const { input, changes } of plans) {
		changes.sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
		if (monthOf(input.startDate) < firstBookedMonth)
			input.ledgerStart = firstOfMonth(firstBookedMonth);
	}
	const leaseEntries = plans.map((plan) => ({ ...plan, id: crypto.randomUUID() }));
	const leaseId = (key: string) => leaseEntries.find((entry) => entry.key === key)!.id;

	// The full history of each lease, for the rows and for what the tenants paid.
	const historyOf = (plan: (typeof plans)[number]): RentChange[] => {
		let current = {
			baseRent: plan.input.baseRent,
			operatingCostPrepayment: plan.input.operatingCostPrepayment,
			heatingCostPrepayment: plan.input.heatingCostPrepayment
		};
		const history: RentChange[] = [
			{ validFrom: plan.input.startDate, status: 'approved', ...current }
		];
		for (const change of plan.changes) {
			current = {
				baseRent: change.baseRent ?? current.baseRent,
				operatingCostPrepayment: change.operatingCostPrepayment ?? current.operatingCostPrepayment,
				heatingCostPrepayment: change.heatingCostPrepayment ?? current.heatingCostPrepayment
			};
			history.push({ validFrom: change.validFrom, status: 'approved', ...current });
		}
		return history;
	};
	// A § 558 increase: demanded three weeks into the third month before it is due, consented to
	// three weeks later, the Vergleichsmiete just above the new rent, within the Kappungsgrenze of
	// 15 % that Berlin, Potsdam and Munich set.
	const comparativeFields = (
		entry: (typeof leaseEntries)[number],
		history: RentChange[],
		position: number,
		deliveredOn: IsoDate,
		comparison: DemoComparison
	) => {
		const floorArea = unitOf(entry.input.unitId).floorArea!;
		const oldRent = history[position - 1];
		const newRent = history[position];
		const raised = entry.changes.filter(
			(change, index) => index < position - 1 && change.reason !== 'statement' && change.baseRent
		);
		const comparativeRent = Math.ceil(newRent.baseRent / floorArea / 10) * 10 + 20;
		const year = deliveredOn.slice(0, 4);
		const demand: ComparativeDemand = {
			deliveredOn,
			baseRent: newRent.baseRent,
			comparativeRent,
			cappingPercent: 15,
			comparisonSource: 'rent_index',
			comparisonDetails:
				`${comparison.index} ${year}, ${comparison.field}, Spanne ` +
				`${formatCents(comparativeRent - 140)} bis ${formatCents(comparativeRent + 160)} je m²`
		};
		const content = {
			unitName: unitOf(entry.input.unitId).name,
			floorArea,
			tenants: entry.input.tenantIds.map((id) => tenantRows.find((row) => row.id === id)!),
			oldRent,
			newRent,
			capBase: cappingBase(history.slice(0, position), newRent.validFrom),
			lastChange: raised.at(-1)?.validFrom ?? entry.input.startDate,
			deliveredOn,
			demand
		};
		return {
			deliveredOn,
			comparativeRent,
			comparisonSource: demand.comparisonSource,
			comparisonDetails: demand.comparisonDetails,
			cappingPercent: demand.cappingPercent,
			letterText: comparativeLetterText(content),
			letterTable: comparativeLetterRows(content)
		};
	};
	const rentChangeRows = leaseEntries.flatMap((entry) => {
		const history = historyOf(entry);
		const rows = entry.changes.map((change, index) => {
			const amounts = history[index + 1];
			const deliveredOn = change.comparison
				? addDays(addMonths(change.validFrom, -3), 20)
				: change.deliveredOn;
			return {
				id: crypto.randomUUID(),
				accountId,
				leaseId: entry.id,
				validFrom: change.validFrom,
				baseRent: amounts.baseRent,
				operatingCostPrepayment: amounts.operatingCostPrepayment,
				heatingCostPrepayment: amounts.heatingCostPrepayment,
				reason: change.reason,
				status: 'approved' as const,
				note: change.note ?? null,
				indexMonth: change.indexMonth ?? null,
				indexValue: change.indexValue ?? null,
				deliveredOn: deliveredOn ?? null,
				...(change.comparison && {
					...comparativeFields(entry, history, index + 1, deliveredOn!, change.comparison),
					consentedOn: addDays(deliveredOn!, 21)
				}),
				createdBy: context.userId
			};
		});
		if (!entry.demand) return rows;
		// The pending demand is not part of what the tenants paid: it ends the history only here.
		const { deliveredOn, baseRent, comparison } = entry.demand;
		const last = entry.changes.findLast((change) => change.reason === 'comparative')!;
		const validFrom = comparativeEffectiveFrom(deliveredOn, last.validFrom);
		const demanded = { ...history.at(-1)!, validFrom, baseRent, status: 'proposed' as const };
		const extended = [...history, demanded];
		return [
			...rows,
			{
				id: crypto.randomUUID(),
				accountId,
				leaseId: entry.id,
				...demanded,
				reason: 'comparative' as const,
				note: null,
				...comparativeFields(entry, extended, extended.length - 1, deliveredOn, comparison),
				createdBy: context.userId
			}
		];
	});
	const personsRows = [
		{
			id: crypto.randomUUID(),
			accountId,
			leaseId: leaseId('berger'),
			validFrom: at(-2, '03-01'),
			persons: 4,
			note: 'Geburt des zweiten Kindes'
		}
	];

	// The bank account. Its last three months and this month are on it; rent of those months came
	// in there and was assigned, Hausgeld, Darlehensraten and Abschläge went out from there.
	const bankAccount = {
		id: crypto.randomUUID(),
		accountId,
		name: 'Mietkonto Berliner Sparkasse',
		iban: 'DE63100500006600099110',
		bic: 'BELADEBEXXX',
		holder: 'Katrin Hoffmann'
	};
	const bankFrom = addMonthsToMonth(lastMonth, -2);
	type DemoTransaction = { id: string; status: 'matched' | 'unmatched'; row: BankRow };
	const transactions: DemoTransaction[] = [];
	const bankTransaction = (
		day: IsoDate,
		amount: number,
		counterpartName: string,
		counterpartIban: string | null,
		purpose: string,
		status: 'matched' | 'unmatched' = 'matched'
	) => {
		const id = crypto.randomUUID();
		transactions.push({
			id,
			status,
			row: {
				bookingDate: day,
				valueDate: day,
				amount,
				counterpartName,
				counterpartIban,
				purpose,
				externalId: null
			}
		});
		return id;
	};
	const onBank = (month: IsoMonth) => month >= bankFrom;

	// Rent paid month by month, a day before it is due. Berger stopped paying two months ago:
	// the arrears tile and the letters below. Nowak and Weber/Albrecht have paid this month too,
	// assigned on import by their rules; Schmidt and Yılmaz are open on the bank account.
	const paymentRows: (typeof payments.$inferInsert)[] = [];
	const reductionMonth = monthOf(at(-2, '02-01'));
	for (const entry of leaseEntries) {
		const history = historyOf(entry);
		const from =
			monthOf(entry.input.startDate) > firstBookedMonth
				? monthOf(entry.input.startDate)
				: firstBookedMonth;
		const to =
			entry.input.endDate && monthOf(entry.input.endDate) < lastMonth
				? monthOf(entry.input.endDate)
				: lastMonth;
		let months = monthsInRange(from, to).slice(
			0,
			entry.unpaidMonths ? -entry.unpaidMonths : undefined
		);
		const autoAssigned = entry.key === 'nowak' || entry.key === 'weber';
		if (autoAssigned) months = [...months, currentMonth];
		for (const month of months) {
			const amounts = monthlyAmounts(history, entry.input, month);
			// Nowak kept back the Mietminderung booked below from the February rent.
			const amount =
				total(amounts) - (entry.key === 'nowak' && month === reductionMonth ? 8500 : 0);
			const day = soFar(nthWorkingDay(month, 2, entry.state));
			const bankTransactionId =
				onBank(month) && entry.bank
					? bankTransaction(
							day,
							amount,
							entry.bank.payer,
							entry.bank.iban,
							entry.bank.purpose(month)
						)
					: null;
			paymentRows.push({
				id: crypto.randomUUID(),
				accountId,
				leaseId: entry.id,
				date: day,
				amount,
				source: bankTransactionId ? 'bank' : 'manual',
				bankTransactionId,
				note: `Miete ${month}`
			});
		}
	}
	// Schmidt transferred the June rent of two years ago twice; the landlord paid the second
	// transfer back: a Rückzahlung, which the Mietkonto shows in Soll.
	{
		const entry = leaseEntries.find((candidate) => candidate.key === 'schmidt')!;
		const month = monthOf(at(-2, '06-01'));
		const amount = total(monthlyAmounts(historyOf(entry), entry.input, month));
		const twice = addDays(nthWorkingDay(month, 2, entry.state), 6);
		for (const [day, signed, note] of [
			[twice, amount, 'Miete Juni doppelt überwiesen'],
			[addDays(twice, 8), -amount, 'Rückzahlung der doppelten Überweisung']
		] as const) {
			paymentRows.push({
				id: crypto.randomUUID(),
				accountId,
				leaseId: entry.id,
				date: day,
				amount: signed,
				source: 'manual',
				bankTransactionId: null,
				note
			});
		}
	}
	for (const key of ['schmidt', 'yilmaz'] as const) {
		const entry = leaseEntries.find((candidate) => candidate.key === key)!;
		const { payer, iban, purpose } = entry.bank!;
		const amount = total(monthlyAmounts(historyOf(entry), entry.input, currentMonth));
		bankTransaction(
			soFar(nthWorkingDay(currentMonth, 2, 'BE')),
			amount,
			payer,
			iban,
			purpose(currentMonth),
			'unmatched'
		);
	}

	// Rules: the two tenants whose rent is assigned on import, and a suggestion not confirmed yet.
	const ruleRows = [
		{
			leaseId: leaseId('nowak'),
			field: 'counterpartIban' as const,
			pattern: 'DE54500105175419038277',
			confirmed: true
		},
		{ leaseId: leaseId('weber'), field: 'purpose' as const, pattern: 'WE 9', confirmed: true },
		{
			leaseId: leaseId('berger'),
			field: 'counterpartName' as const,
			pattern: 'Berger',
			confirmed: false
		}
	].map((row) => ({ id: crypto.randomUUID(), accountId, ...row }));

	// Deposits: received at the start, interest on the Mietkautionskonto at every year end, and
	// paid back to the former tenants after moving out, less the cost of repairs they owed.
	const depositRows: (typeof depositTransactions.$inferInsert)[] = [];
	const deposit = (
		leaseKey: string,
		day: IsoDate,
		kind: 'received' | 'interest' | 'returned' | 'withheld',
		amount: number,
		note: string
	) =>
		depositRows.push({
			id: crypto.randomUUID(),
			accountId,
			leaseId: leaseId(leaseKey),
			date: day,
			kind,
			amount: signedDepositAmount(kind, amount),
			note,
			bankTransactionId: null
		});
	for (const entry of leaseEntries) {
		deposit(
			entry.key,
			soFar(entry.input.startDate),
			'received',
			entry.input.securityDeposit,
			'Überweisung auf das Mietkautionskonto'
		);
		let balance = entry.input.securityDeposit;
		const startYear = Math.max(Number(entry.input.startDate.slice(0, 4)), firstYear);
		const endYear = entry.input.endDate
			? Math.min(Number(entry.input.endDate.slice(0, 4)) - 1, Y - 1)
			: Y - 1;
		for (let year = startYear; year <= endYear; year += 1) {
			const interest = Math.round((balance * byYear(DEPOSIT_RATE, year)) / 100);
			if (interest <= 0) continue;
			balance += interest;
			deposit(entry.key, `${year}-12-31`, 'interest', interest, `Zinsen Mietkautionskonto ${year}`);
		}
		if (entry.moveOut) {
			const { day, withheld } = entry.moveOut;
			if (withheld) deposit(entry.key, day, 'withheld', withheld[0], withheld[1]);
			deposit(
				entry.key,
				day,
				'returned',
				balance - (withheld?.[0] ?? 0),
				'Rückzahlung nach Auszug'
			);
		}
	}

	// Belege: every history year of every property. The Mehrfamilienhaus gets its bills itself;
	// the Eigentumswohnungen get theirs from the Hausgeldabrechnung, with the WEG's figures.
	type CostItemRow = typeof costItems.$inferInsert;
	const costItemRows: CostItemRow[] = [];
	const unitAmountRows: (typeof costItemUnitAmounts.$inferInsert)[] = [];
	const expenseRows: (typeof expenses.$inferInsert)[] = [];
	const expense = (
		day: IsoDate,
		amount: number,
		category: ExpenseCategory,
		description: string,
		propertyId: string | null,
		unit: string | null = null,
		bankTransactionId: string | null = null
	) =>
		expenseRows.push({
			id: crypto.randomUUID(),
			accountId,
			propertyId,
			unitId: unit ? unitId(unit) : null,
			date: day,
			amount,
			category,
			description,
			bankTransactionId
		});
	const costItem = (row: Omit<CostItemRow, 'id' | 'accountId'>) => {
		const id = crypto.randomUUID();
		costItemRows.push({ id, accountId, ...row });
		return id;
	};
	const yearItem = (
		propertyId: string,
		year: number,
		category: string,
		description: string,
		supplier: string,
		amount: number,
		extra: Partial<CostItemRow> = {}
	) =>
		costItem({
			propertyId,
			categoryId: categoryId(category),
			allocationKeyId: extra.allocationKeyId ?? defaultKeyId(category),
			billingCircleId: null,
			description,
			supplier,
			invoiceDate: `${year}-12-10`,
			periodStart: `${year}-01-01`,
			periodEnd: `${year}-12-31`,
			amount,
			allocable: true,
			...extra
		});

	// Grundsteuer: quarterly to the city, from the reform of 2025 on a new assessment.
	const grundsteuer = {
		[lindenId]: [61200, 72400],
		[parkId]: [31200, 28800],
		[rosenheimId]: [19800, 21600]
	};
	const cities = {
		[lindenId]: 'Finanzamt Friedrichshain-Kreuzberg',
		[parkId]: 'Landeshauptstadt Potsdam',
		[rosenheimId]: 'Landeshauptstadt München'
	};
	const grundsteuerOf = (propertyId: string, year: number) =>
		grundsteuer[propertyId][year >= 2025 ? 1 : 0];
	/** The Lindenstraße's Grundsteuer Belege by year; the Bescheid is stored as their receipt. */
	const lindenGrundsteuer = new Map<number, string>();
	for (const propertyId of [lindenId, parkId, rosenheimId]) {
		for (const year of [...historyYears, Y]) {
			const amount = grundsteuerOf(propertyId, year);
			if (year < Y) {
				const id = yearItem(
					propertyId,
					year,
					'Grundsteuer',
					`Grundsteuer ${year}`,
					cities[propertyId],
					amount,
					{ invoiceDate: `${year}-01-20` }
				);
				if (propertyId === lindenId) lindenGrundsteuer.set(year, id);
			}
			for (const day of ['02-15', '05-15', '08-15', '11-15']) {
				if (`${year}-${day}` <= date)
					expense(
						`${year}-${day}`,
						amount / 4,
						'operating_costs',
						`Grundsteuer ${year}`,
						propertyId
					);
			}
		}
	}

	// The Mehrfamilienhaus: the bills of the year, paid when they came.
	const lindenBills: [string, string, string, number, string?][] = [
		['Wasserversorgung', 'Frischwasser', 'Berliner Wasserbetriebe', 52000, 'Personen'],
		[
			'Entwässerung',
			'Schmutz- und Niederschlagswasser',
			'Berliner Wasserbetriebe',
			61000,
			'Personen'
		],
		[
			'Straßenreinigung und Müllbeseitigung',
			'Müllabfuhr und Straßenreinigung',
			'Berliner Stadtreinigung',
			54000
		],
		[
			'Gebäudereinigung und Ungezieferbekämpfung',
			'Treppenhausreinigung',
			'Glanz & Co. Gebäudeservice',
			46800
		],
		['Gartenpflege', 'Pflege von Hof und Vorgarten', 'Grünwerk Kreuzberg', 21600],
		['Beleuchtung', 'Allgemeinstrom Treppenhaus und Keller', 'Vattenfall', 14500],
		[
			'Schornsteinreinigung',
			'Abgasmessung und Feuerstättenschau',
			'Bezirksschornsteinfeger Lehmann',
			9800
		],
		['Hauswart', 'Hausmeisterdienst', 'Hausmeisterservice Krüger', 72000],
		['Heizung', 'Wartung der Heizung, Miete und Ablesung der Zähler', 'ista SE', 61000]
	];
	const gasCost = (year: number) => Math.round(byYear(GAS_KWH, year) * byYear(GAS_PRICE, year));
	for (const year of historyYears) {
		const index = byYear(COST_INDEX, year);
		for (const [category, description, supplier, base, key] of lindenBills) {
			const amount = Math.round(base * index);
			yearItem(
				lindenId,
				year,
				category,
				`${description} ${year}`,
				supplier,
				amount,
				key ? { allocationKeyId: keyId(key) } : {}
			);
			expense(`${year}-12-10`, amount, 'operating_costs', `${description} ${year}`, lindenId);
		}
		// The gas bill: CO₂ on the invoice since the CO2KostAufG (2023), split before allocating.
		const kwh = byYear(GAS_KWH, year);
		const co2Kg = co2KgFromKwh('gas', kwh)!;
		const co2 =
			year >= 2023
				? {
						fuel: 'gas' as const,
						fuelKwh: kwh,
						co2Kg,
						co2Cost: Math.round((co2Kg / 1000) * byYear(CO2_PRICE, year) * 1.19 * 100)
					}
				: { fuel: 'gas' as const, fuelKwh: kwh };
		yearItem(lindenId, year, 'Heizung', `Erdgas ${year}`, 'GASAG', gasCost(year), {
			invoiceDate: `${year + 1}-01-25`,
			...co2
		});
		yearItem(
			lindenId,
			year,
			'Verwaltungskosten (nicht umlagefähig)',
			`Kontoführung Mietkonto ${year}`,
			'Berliner Sparkasse',
			9600,
			{ allocable: false }
		);
	}
	// Gas: monthly Abschläge by last year's bill and the Jahresabrechnung in February.
	for (const month of monthsInRange(firstBookedMonth, currentMonth)) {
		const year = Number(month.slice(0, 4));
		const advance = Math.round(gasCost(year - 1) / 12);
		const day = soFar(addDays(firstOfMonth(month), 14));
		const transaction = onBank(month)
			? bankTransaction(
					day,
					-advance,
					'GASAG AG',
					'DE54100500006603058742',
					`Abschlag Erdgas Lindenstr. 12 ${month}`,
					month === currentMonth ? 'unmatched' : 'matched'
				)
			: null;
		if (month !== currentMonth || !transaction)
			expense(day, advance, 'operating_costs', 'Abschlag Erdgas', lindenId, null, transaction);
		if (month.endsWith('-02') && year - 1 >= firstYear && addDays(day, 5) <= date) {
			const settlement = gasCost(year - 1) - 12 * Math.round(gasCost(year - 2) / 12);
			expense(
				addDays(firstOfMonth(month), 19),
				settlement,
				'operating_costs',
				`Jahresabrechnung Erdgas ${year - 1}`,
				lindenId
			);
		}
	}

	// Insurances of the Mehrfamilienhaus; their years run from 1 March. The legal expenses
	// insurance renews on 1 February, so its notice deadline is at the end of October.
	const buildingPolicy = {
		id: crypto.randomUUID(),
		accountId,
		propertyId: lindenId,
		kind: 'building' as const,
		insurer: 'Allianz',
		policyNumber: 'GV-4471-0921',
		annualPremium: Math.round(byYear(BUILDING_PREMIUM, Y)),
		renewalDate: acquisition[lindenId],
		noticeMonths: 3,
		note: 'Gleitender Neuwert, inklusive Elementarschäden.'
	};
	const liabilityPolicy = {
		id: crypto.randomUUID(),
		accountId,
		propertyId: lindenId,
		kind: 'liability' as const,
		insurer: 'HUK-COBURG',
		policyNumber: 'HG 553 120 7',
		annualPremium: 17800,
		renewalDate: acquisition[lindenId],
		noticeMonths: 3,
		note: null
	};
	const legalPolicy = {
		id: crypto.randomUUID(),
		accountId,
		propertyId: lindenId,
		kind: 'legal' as const,
		insurer: 'ARAG',
		policyNumber: 'VR-208 334',
		annualPremium: 34900,
		renewalDate: at(-4, '02-01'),
		noticeMonths: 3,
		note: 'Vermieter-Rechtsschutz für alle drei Objekte.'
	};
	for (let offset = -HISTORY_YEARS - 1; offset <= 0; offset += 1) {
		const start = at(offset, '03-01');
		const end = addDays(at(offset + 1, '03-01'), -1);
		const premiums: [typeof buildingPolicy | typeof liabilityPolicy, number][] = [
			[buildingPolicy, Math.round(byYear(BUILDING_PREMIUM, Y + offset))],
			[liabilityPolicy, offset < -2 ? 16500 : 17800]
		];
		for (const [policy, amount] of premiums) {
			const description = `${policy.kind === 'building' ? 'Wohngebäudeversicherung' : 'Haus- und Grundbesitzerhaftpflicht'} ${formatDate(start)} – ${formatDate(end)}`;
			costItem({
				propertyId: lindenId,
				categoryId: categoryId('Sach- und Haftpflichtversicherung'),
				allocationKeyId: defaultKeyId('Sach- und Haftpflichtversicherung'),
				billingCircleId: null,
				description,
				supplier: policy.insurer,
				invoiceDate: addDays(start, -30),
				periodStart: start,
				periodEnd: end,
				amount,
				allocable: true,
				insurancePolicyId: policy.id
			});
			if (start >= firstOfMonth(firstBookedMonth))
				expense(start, amount, 'operating_costs', description, lindenId);
		}
	}
	for (let year = Y - 4; year <= Y; year += 1) {
		expense(
			`${year}-02-01`,
			legalPolicy.annualPremium,
			'other',
			`Vermieter-Rechtsschutz ${year}`,
			lindenId
		);
	}

	// Heat meters of the flats, read on 31 December, and between the tenants of EG rechts.
	const meterRows: (typeof meters.$inferInsert)[] = [];
	const readingRows: (typeof meterReadings.$inferInsert)[] = [];
	const heatWeights: [string, number, string][] = [
		['Wohnung EG links', 62, 'WMZ 4471 0021'],
		['Wohnung EG rechts', 58 * 0.92, 'WMZ 4471 0022'],
		['Wohnung 1. OG', 76 * 1.08, 'WMZ 4471 0023']
	];
	const weightTotal = heatWeights.reduce((sum, [, weight]) => sum + weight, 0);
	/** Readings between tenants: the day, and the share of the year's heat used by then. */
	const changeovers: [unit: string, readAt: IsoDate, part: number, note: string][] = [
		['Wohnung EG links', at(-6, '03-31'), 0.62, 'Zwischenablesung bei Mieterwechsel'],
		['Wohnung EG rechts', at(-4, '08-31'), 0.7, 'Zwischenablesung bei Auszug'],
		['Wohnung EG rechts', at(-4, '09-30'), 0.71, 'Zwischenablesung bei Einzug']
	];
	for (const [name, weight, serialNumber] of heatWeights) {
		const id = crypto.randomUUID();
		meterRows.push({
			id,
			accountId,
			propertyId: lindenId,
			unitId: unitId(name),
			kind: 'heat',
			serialNumber,
			unit: 'kWh',
			location: 'Flur, Heizkreisverteiler',
			installedAt: at(-12, '09-15'),
			removedAt: null
		});
		let value = 18_000 + Math.round(weight * 50);
		const reading = (readAt: IsoDate, note: string | null = null) =>
			readingRows.push({
				id: crypto.randomUUID(),
				accountId,
				meterId: id,
				readAt,
				value,
				estimated: false,
				note
			});
		reading(at(-HISTORY_YEARS - 1, '12-31'));
		for (const year of historyYears) {
			// Four fifths of the gas reaches the flats; the rest stays in boiler and pipes.
			const used = Math.round((byYear(GAS_KWH, year) * 0.8 * weight) / weightTotal);
			const start = value;
			for (const [unit, readAt, part, note] of changeovers) {
				if (unit !== name || Number(readAt.slice(0, 4)) !== year) continue;
				value = start + Math.round(used * part);
				reading(readAt, note);
			}
			value = start + used;
			reading(`${year}-12-31`);
		}
	}

	// The Eigentumswohnungen: the WEG's costs of each year, the flat's share by MEA and, for the
	// heating, by the meter service's units. The Verwalter's Hausgeldabrechnung sums them up.
	type WegCost = [category: string, description: string, total2021: number];
	const wegs = [
		{
			propertyId: parkId,
			unit: 'Wohnung 14',
			share: 71.3,
			manager: 'Havelland Hausverwaltung GmbH',
			managerIban: 'DE14160500001000123459',
			costs: [
				['Wasserversorgung', 'Wasser und Abwasser', 520000],
				['Straßenreinigung und Müllbeseitigung', 'Müllabfuhr', 270000],
				['Gebäudereinigung und Ungezieferbekämpfung', 'Treppenhausreinigung', 230000],
				['Gartenpflege', 'Gartenpflege und Winterdienst', 150000],
				['Beleuchtung', 'Allgemeinstrom', 90000],
				['Aufzug', 'Aufzug: Wartung, Notruf und TÜV', 260000],
				['Sach- und Haftpflichtversicherung', 'Gebäude- und Haftpflichtversicherung', 330000],
				['Hauswart', 'Hausmeister', 360000]
			] as WegCost[],
			heating: { total2021: 1_650_000, keyTotal: 100_000, shares: [7450, 7120, 6980, 7210, 7300] },
			nonAllocable2021: 48000,
			reserve: (year: number) => (year >= 2024 ? 81600 : 65280),
			withdrawal: { [Y - 2]: 185000 } as Record<number, number>
		},
		{
			propertyId: rosenheimId,
			unit: 'Wohnung 9',
			share: 48.6,
			manager: 'Isar Immobilienverwaltung KG',
			managerIban: 'DE72701500001009876543',
			costs: [
				['Wasserversorgung', 'Wasser und Abwasser', 610000],
				['Straßenreinigung und Müllbeseitigung', 'Müllabfuhr und Straßenreinigung', 340000],
				['Gebäudereinigung und Ungezieferbekämpfung', 'Treppenhausreinigung', 300000],
				['Gartenpflege', 'Gartenpflege', 190000],
				['Beleuchtung', 'Allgemeinstrom', 110000],
				['Sach- und Haftpflichtversicherung', 'Gebäude- und Haftpflichtversicherung', 420000],
				['Hauswart', 'Hausmeister', 440000]
			] as WegCost[],
			heating: null,
			nonAllocable2021: 51600,
			reserve: (year: number) => (year >= 2024 ? 77760 : 71280),
			withdrawal: {} as Record<number, number>
		}
	];
	const heatingFactor = (year: number) =>
		0.3 + (0.7 * byYear(GAS_PRICE, year)) / byYear(GAS_PRICE, 2021);
	const associationRows: (typeof associationStatements.$inferInsert)[] = [];
	for (const weg of wegs) {
		/** The flat's share of the WEG's costs of a year, allocable and not. */
		const figures = (year: number) => {
			const index = byYear(COST_INDEX, year);
			const items = weg.costs.map(([category, description, total2021]) => {
				const associationTotal = Math.round(total2021 * index);
				return {
					category,
					description,
					associationTotal,
					amount: Math.round((associationTotal * weg.share) / 1000)
				};
			});
			const heatingShare =
				weg.heating?.shares[(year + weg.heating.shares.length) % weg.heating.shares.length];
			const heatingTotal = weg.heating
				? Math.round(weg.heating.total2021 * heatingFactor(year))
				: 0;
			const heatingAmount = weg.heating
				? Math.round((heatingTotal * heatingShare!) / weg.heating.keyTotal)
				: 0;
			const allocable = items.reduce((sum, item) => sum + item.amount, 0) + heatingAmount;
			const nonAllocable = Math.round(weg.nonAllocable2021 * index);
			return {
				items,
				heatingShare,
				heatingTotal,
				heatingAmount,
				allocable,
				nonAllocable,
				reserve: weg.reserve(year)
			};
		};
		const costsOf = (year: number) => {
			const f = figures(year);
			return f.allocable + f.nonAllocable + f.reserve;
		};
		/** The Hausgeld of the Wirtschaftsplan: last year's costs, rounded up. */
		const hausgeld = (year: number) => ceilToFive(costsOf(year - 1) / 12);
		for (const year of historyYears) {
			const f = figures(year);
			const statementDate = `${year + 1}-04-28`;
			for (const item of f.items) {
				yearItem(
					weg.propertyId,
					year,
					item.category,
					`${item.description} ${year} (Hausgeldabrechnung)`,
					weg.manager,
					item.amount,
					{
						invoiceDate: statementDate,
						associationTotal: item.associationTotal,
						associationKey: 'MEA',
						associationKeyTotal: 1000,
						associationKeyShare: weg.share
					}
				);
			}
			if (weg.heating) {
				const id = yearItem(
					weg.propertyId,
					year,
					'Verbundene Heizungs- und Warmwasserversorgung',
					`Heizung und Warmwasser ${year} (Heizkostenabrechnung Techem)`,
					weg.manager,
					f.heatingAmount,
					{
						allocationKeyId: keyId('Beträge je Einheit'),
						invoiceDate: statementDate,
						associationTotal: f.heatingTotal,
						associationKey: 'Verbrauchseinheiten',
						associationKeyTotal: weg.heating.keyTotal,
						associationKeyShare: f.heatingShare!
					}
				);
				unitAmountRows.push({
					accountId,
					costItemId: id,
					unitId: unitId(weg.unit),
					amount: f.heatingAmount
				});
			}
			const feesDue = 12 * hausgeld(year);
			associationRows.push({
				id: crypto.randomUUID(),
				accountId,
				propertyId: weg.propertyId,
				periodStart: `${year}-01-01`,
				periodEnd: `${year}-12-31`,
				allocableCosts: f.allocable,
				nonAllocableCosts: f.nonAllocable,
				reserveContribution: f.reserve,
				reserveWithdrawal: weg.withdrawal[year] ?? 0,
				feesDue,
				statedBalance: f.allocable + f.nonAllocable + f.reserve - feesDue,
				note: weg.withdrawal[year] ? 'Dachsanierung aus der Erhaltungsrücklage bezahlt.' : null
			});
		}
		// Hausgeld on the first working day of every month.
		for (const month of monthsInRange(firstBookedMonth, currentMonth)) {
			const day = soFar(nthWorkingDay(month, 1, stateOf[weg.propertyId]));
			const amount = hausgeld(Number(month.slice(0, 4)));
			const transaction = onBank(month)
				? bankTransaction(
						day,
						-amount,
						weg.manager,
						weg.managerIban,
						`Hausgeld ${month} ${propertyRows.find((row) => row.id === weg.propertyId)!.name}`
					)
				: null;
			expense(day, amount, 'association_fee', 'Hausgeld', weg.propertyId, null, transaction);
		}
	}
	// What the Eigentumswohnungen cost the owner directly.
	for (const year of historyYears) {
		yearItem(
			rosenheimId,
			year,
			'Schornsteinreinigung',
			`Schornsteinfeger Gastherme ${year}`,
			'Kaminkehrer Huber',
			Math.round(7500 * byYear(COST_INDEX, year)),
			{
				invoiceDate: `${year}-09-20`
			}
		);
		expense(
			`${year}-09-20`,
			Math.round(7500 * byYear(COST_INDEX, year)),
			'operating_costs',
			`Schornsteinfeger Gastherme ${year}`,
			rosenheimId
		);
		expense(
			`${year}-10-05`,
			Math.round(16500 * byYear(COST_INDEX, year)),
			'maintenance',
			`Wartung Gastherme ${year}`,
			rosenheimId,
			'Wohnung 9'
		);
	}
	expense(at(-2, '09-01'), 380000, 'special_levy', 'Sonderumlage Fassadensanierung', rosenheimId);
	expense(
		at(-1, '03-01'),
		150000,
		'special_levy_reserve',
		'Sonderumlage zur Aufstockung der Erhaltungsrücklage',
		parkId
	);

	// Darlehensraten: annuity loans from the month after acquisition, interest per year as the
	// bank's Zinsbescheinigung states it.
	const loans: [string, Loan, string | null][] = [
		[
			lindenId,
			{ principal: 520_000_00, ratePercent: 1.65, payment: 1_798_33, lender: 'Berliner Sparkasse' },
			null
		],
		[
			parkId,
			{
				principal: 200_000_00,
				ratePercent: 1.35,
				payment: 725_00,
				lender: 'Mittelbrandenburgische Sparkasse'
			},
			'DE08160500003502219846'
		],
		[
			rosenheimId,
			{
				principal: 380_000_00,
				ratePercent: 1.05,
				payment: 965_83,
				lender: 'Stadtsparkasse München'
			},
			'DE75701500001002783946'
		]
	];
	const taxYearRows: (typeof taxYears.$inferInsert)[] = [];
	for (const [propertyId, loan, iban] of loans) {
		const first = addMonthsToMonth(monthOf(acquisition[propertyId]), 1);
		const interest = loanInterestByYear(loan, first, lastMonth);
		for (const year of historyYears) {
			taxYearRows.push({
				id: crypto.randomUUID(),
				accountId,
				propertyId,
				year,
				loanInterest: interest.get(year) ?? 0
			});
		}
		for (const month of monthsInRange(firstBookedMonth, lastMonth)) {
			const day = lastOfMonth(month);
			const transaction = onBank(month)
				? bankTransaction(day, -loan.payment, loan.lender, iban, `Darlehensrate ${month}`)
				: null;
			expense(
				day,
				loan.payment,
				'loan_payment',
				`Darlehensrate ${loan.lender}`,
				propertyId,
				null,
				transaction
			);
		}
	}

	// Repairs, modernisation and the costs of managing the portfolio.
	expense(
		at(-4, '09-22'),
		485000,
		'maintenance',
		'Malerarbeiten und neuer Bodenbelag nach Auszug',
		lindenId,
		'Wohnung EG rechts'
	);
	expense(
		at(-3, '02-14'),
		124000,
		'maintenance',
		'Heizungsreparatur: Umwälzpumpe getauscht',
		lindenId
	);
	expense(
		at(-3, '10-10'),
		89000,
		'modernization',
		'Funk-Rauchwarnmelder, alle Wohnungen',
		lindenId
	);
	expense(
		at(-8, '09-03'),
		214000,
		'modernization',
		'Klingel- und Gegensprechanlage erneuert',
		lindenId
	);
	expense(at(-5, '07-14'), 156000, 'maintenance', 'Hofpflaster ausgebessert', lindenId);
	expense(
		at(-7, '04-12'),
		412000,
		'maintenance',
		'Renovierung vor Neuvermietung: Böden, Malerarbeiten, Badfliesen',
		parkId,
		'Wohnung 14'
	);
	expense(
		at(-6, '11-15'),
		268000,
		'maintenance',
		'Malerarbeiten und Kleinreparaturen vor Neuvermietung',
		rosenheimId,
		'Wohnung 9'
	);
	expense(at(-1, '06-18'), 318000, 'maintenance', 'Wasserschaden Bad', lindenId, 'Wohnung 1. OG');
	expense(at(0, '04-09'), 89000, 'maintenance', 'Dachrinne und Fallrohr erneuert', lindenId);
	expense(at(-2, '11-12'), 34000, 'maintenance', 'Badarmatur getauscht', parkId, 'Wohnung 14');
	expense(
		at(-1, '09-03'),
		61000,
		'maintenance',
		'Gastherme: Wärmetauscher repariert',
		rosenheimId,
		'Wohnung 9'
	);
	for (const year of historyYears) {
		expense(
			`${year}-05-20`,
			Math.round(69000 * byYear(COST_INDEX, year)),
			'management',
			`Steuerberatung Anlage V ${year - 1}`,
			null
		);
		expense(`${year}-01-15`, 9800, 'other', `Mitgliedsbeitrag Haus & Grund ${year}`, null);
	}

	const fingerprinted = await fingerprintRows(transactions.map((entry) => entry.row));
	const transactionRows = fingerprinted.map((row, index) => ({
		id: transactions[index].id,
		accountId,
		bankAccountId: bankAccount.id,
		importId: null,
		status: transactions[index].status as 'matched' | 'unmatched' | 'ignored',
		...row
	}));

	// The Rücklagenkonto: the monthly transfer to the Instandhaltungsrücklage for two years, but its
	// statements were last loaded two months ago, so the task list asks for them.
	const reserveAccount = {
		id: crypto.randomUUID(),
		accountId,
		name: 'Rücklagenkonto DKB',
		iban: 'DE02120300000000202051',
		bic: 'BYLADEM1001',
		holder: 'Katrin Hoffmann'
	};
	const reserveRows = await fingerprintRows(
		monthsInRange(addMonthsToMonth(lastMonth, -24), addMonthsToMonth(lastMonth, -1)).map(
			(month): BankRow => ({
				bookingDate: `${month}-05`,
				valueDate: `${month}-05`,
				amount: 25000,
				counterpartName: 'Katrin Hoffmann',
				counterpartIban: bankAccount.iban,
				purpose: `Übertrag Instandhaltungsrücklage ${month}`,
				externalId: null
			})
		)
	);
	transactionRows.push(
		...reserveRows.map((row) => ({
			id: crypto.randomUUID(),
			accountId,
			bankAccountId: reserveAccount.id,
			importId: null,
			status: 'ignored' as const,
			...row
		}))
	);

	// Drafts of the Betriebskostenabrechnungen of every history year but the last, approved below.
	const drafts = historyYears.slice(0, -1).flatMap((year) =>
		[
			[lindenId, `${year + 1}-05-12`],
			// The Eigentumswohnungen after the Verwalter's Hausgeldabrechnung of late April.
			[parkId, `${year + 1}-06-10`],
			[rosenheimId, `${year + 1}-06-10`]
		].map(([propertyId, approvedOn]) => ({ id: crypto.randomUUID(), propertyId, year, approvedOn }))
	);
	const draftRows = drafts.map((draft) => ({
		id: draft.id,
		accountId,
		propertyId: draft.propertyId,
		periodStart: `${draft.year}-01-01`,
		periodEnd: `${draft.year}-12-31`,
		version: 1,
		status: 'draft' as const
	}));

	// Tasks: two repeating, one for the tenant in arrears, the handover of the flat being re-let, one
	// overdue (so the start page shows how it marks one), one done.
	const taskRows = [
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Rauchwarnmelder prüfen lassen',
			category: 'inspection' as const,
			dueDate: addMonths(date, 1),
			repeatMonths: 12,
			repeatAnchor: addMonths(date, 1),
			propertyId: lindenId,
			leaseId: null,
			note: 'Jährliche Funktionsprüfung, alle Wohnungen.'
		},
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Wartung der Gastherme beauftragen',
			category: 'maintenance' as const,
			dueDate: addDays(date, 21),
			repeatMonths: 12,
			repeatAnchor: addDays(date, 21),
			propertyId: rosenheimId,
			leaseId: null,
			note: 'Termin mit Frau Weber abstimmen.'
		},
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Fristlose Kündigung prüfen',
			dueDate: addDays(date, 7),
			propertyId: null,
			leaseId: leaseId('berger'),
			note: 'Zwei Monatsmieten offen (§ 543 Abs. 2 Nr. 3 BGB); Mahnung ist verschickt.'
		},
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Wohnungsübergabe Wohnung 14 mit Abnahmeprotokoll',
			dueDate: moveOutDay,
			propertyId: null,
			leaseId: leaseId('nowak'),
			note: 'Zählerstände ablesen, Schlüssel an Frau Krüger übergeben.'
		},
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Angebote für die Treppenhausreinigung einholen',
			dueDate: addDays(date, -3),
			propertyId: lindenId,
			leaseId: null,
			note: 'Der Vertrag mit Glanz & Co. läuft zum Jahresende aus.'
		},
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Eigentümerversammlung Parkallee: Vollmacht schicken',
			dueDate: addDays(date, -12),
			done: true,
			doneAt: new Date(`${addDays(date, -14)}T09:00:00Z`),
			propertyId: parkId,
			leaseId: null,
			note: null
		}
	];

	// The audit lines the features' own functions write.
	const audit = (entity: string, entityId: string, summary: string) => ({
		id: crypto.randomUUID(),
		accountId,
		userId: context.userId,
		entity,
		entityId,
		action: 'create' as const,
		summary
	});
	const auditRows = [
		audit(
			'bankAccount',
			bankAccount.id,
			`Bankverbindung „${bankAccount.name}“ (${formatIban(bankAccount.iban)}) angelegt`
		),
		audit(
			'bankAccount',
			reserveAccount.id,
			`Bankverbindung „${reserveAccount.name}“ (${formatIban(reserveAccount.iban)}) angelegt`
		),
		...costItemRows.map((item) =>
			audit(
				'cost_item',
				item.id!,
				`Beleg ${item.description} (${formatCents(item.amount)}) angelegt`
			)
		),
		...taskRows.map((task) =>
			audit('task', task.id, `Aufgabe „${task.title}“ (bis ${formatDate(task.dueDate)}) angelegt`)
		)
	];

	// Without a property the account has no units, leases or cost items, but it may hold tenants,
	// bank accounts and tasks up to their limits.
	const adding: [QuotaKind, number][] = [
		['tenants', tenantRows.length],
		['bankAccounts', 2],
		['bankTransactions', transactionRows.length],
		['matchingRules', ruleRows.length],
		['expenses', expenseRows.length],
		['tasks', taskRows.length]
	];
	for (const [kind, rows] of adding) await assertQuota(db, accountId, kind, rows);

	const insert = <T extends Table>(table: T, rows: T['$inferInsert'][]) =>
		chunk(rows, rowsPerStatement(table)).map((group) => db.insert(table).values(group));
	try {
		await runBatch(db, [
			...insert(properties, propertyRows),
			...insert(units, unitRows),
			...insert(tenants, tenantRows),
			...newLeaseStatements(db, context, leaseEntries),
			...insert(rentChanges, rentChangeRows),
			...insert(leasePersons, personsRows),
			...insert(depositTransactions, depositRows),
			...insert(bankAccounts, [bankAccount, reserveAccount]),
			...insert(bankTransactions, transactionRows),
			...insert(payments, paymentRows),
			...insert(matchingRules, ruleRows),
			...insert(insurancePolicies, [buildingPolicy, liabilityPolicy, legalPolicy]),
			...insert(costItems, costItemRows),
			...insert(costItemUnitAmounts, unitAmountRows),
			...insert(meters, meterRows),
			...insert(meterReadings, readingRows),
			...insert(associationStatements, associationRows),
			...insert(operatingCostStatements, draftRows),
			...insert(expenses, expenseRows),
			...insert(tasks, taskRows),
			...insert(taxYears, taxYearRows),
			...insert(auditLog, auditRows),
			// The last line is also the guard against a second run at the same time (a double
			// click): both pass isEmptyAccount, but once one batch is in, the other sees three
			// properties, the summary is NULL and its whole batch is rolled back.
			db.insert(auditLog).values({
				accountId,
				userId: context.userId,
				entity: 'account',
				entityId: accountId,
				action: 'create',
				summary: sql`(select case when count(*) = ${propertyRows.length} then ${'Demodaten angelegt'} end from ${properties} where ${properties.accountId} = ${accountId})`
			})
		]);
	} catch (error) {
		if (!(await isEmptyAccount(db, accountId))) return { ok: false, reason: 'not-empty' };
		throw error;
	}

	// The landlord's year, made with the features' own functions on the day it happened.
	// A failure from here on takes the demo's rows out again, so the account is empty and the
	// button offers the demo again; rows the account held before stay.
	const documentIds: string[] = [];
	try {
		// Betriebskostenabrechnungen of the past years, each approved in the spring after and delivered
		// two days later; the tenants paid a Nachzahlung three weeks later, a Guthaben went back after
		// two. Last year's are still to do: the deadline in the Fristen.
		for (const draft of drafts) {
			const approval = await approveStatement(
				db,
				context,
				draft.id,
				{ lateApprovalJustified: false, note: null },
				{ today: draft.approvedOn }
			);
			if (!approval.ok) throw new Error(approval.message);
			const deliveredOn = addDays(draft.approvedOn, 2);
			const results = await db
				.select({ leaseId: statementResults.leaseId, balance: statementResults.balance })
				.from(statementResults)
				.where(
					and(eq(statementResults.accountId, accountId), eq(statementResults.statementId, draft.id))
				);
			const settlements = results
				.filter((result) => result.balance !== 0)
				.map((result) => ({
					id: crypto.randomUUID(),
					accountId,
					leaseId: result.leaseId,
					date: addDays(deliveredOn, result.balance > 0 ? 21 : 14),
					amount: result.balance,
					source: 'manual' as const,
					bankTransactionId: null,
					note:
						result.balance > 0
							? `Nachzahlung Betriebskosten ${draft.year}`
							: `Guthaben Betriebskosten ${draft.year} erstattet`
				}));
			// What setDelivered records for a delivery within the deadline, for all leases at once: the
			// date, and the Nachzahlungen fall due 30 days later.
			await runBatch(db, [
				db
					.update(statementResults)
					.set({ deliveredOn })
					.where(
						and(
							eq(statementResults.accountId, accountId),
							eq(statementResults.statementId, draft.id)
						)
					),
				db
					.update(rentCharges)
					.set({ dueDate: addDays(deliveredOn, DUE_DAYS) })
					.where(
						and(
							eq(rentCharges.accountId, accountId),
							eq(rentCharges.referenceId, draft.id),
							isNull(rentCharges.dueDate)
						)
					),
				...insert(payments, settlements),
				auditEntry(
					db,
					context,
					'statement',
					draft.id,
					'update',
					`Betriebskostenabrechnung ${draft.year} am ${formatDate(deliveredOn)} allen Mietern zugestellt`
				)
			]);
		}

		// Berger: a Zahlungserinnerung after the first missed rent, a Mahnung with Verzugszinsen after
		// the second, each on the tenth working day of the month.
		for (const [level, month, days] of [
			[1, addMonthsToMonth(lastMonth, -1), 14],
			[2, lastMonth, 10]
		] as const) {
			const letterDate = nthWorkingDay(month, 10, 'BE');
			const reminder = await createReminder(db, context, leaseId('berger'), {
				level,
				date: soFar(letterDate),
				paymentDeadline: addDays(soFar(letterDate), days)
			});
			if (!reminder?.ok) throw new Error(reminder?.message ?? 'Mahnung nicht erstellt');
			if (level === 2) {
				// The landlord added a line to the Mahnung after a call, on its sheet in the preview.
				const { letter } = (await reminderLetter(db, accountId, leaseId('berger'), reminder.id))!;
				const paragraphs = letter.blocks!.flatMap((block) =>
					'paragraph' in block ? [block.paragraph] : []
				);
				paragraphs.splice(
					3,
					0,
					'Wie am Telefon besprochen, können Sie den Betrag auch in zwei Raten zahlen: die Hälfte bis zur genannten Frist, den Rest bis zum Monatsende.'
				);
				const edited = await updateReminderText(
					db,
					context,
					leaseId('berger'),
					reminder.id,
					paragraphs
				);
				if (!edited?.ok) throw new Error('Text der Mahnung nicht geändert');
			}
		}

		// Nowak's heating failed for a week two winters ago: the landlord booked the Mietminderung
		// by hand, a correction to open and change on the Mietkonto tab.
		const reduction = await postCharge(db, context, {
			leaseId: leaseId('nowak'),
			kind: 'adjustment',
			period: reductionMonth,
			dueDate: at(-2, '02-01'),
			amount: -8500,
			note: 'Mietminderung Heizungsausfall 12.–19. Januar'
		});
		if (!reduction) throw new Error('Korrektur nicht gebucht');

		// Weber and Albrecht heat with their own gas contract and claimed the landlord's CO₂ share of
		// last year (§ 6 CO2KostAufG).
		const weberKwh = 7900;
		const weberCo2 = co2KgFromKwh('gas', weberKwh)!;
		const split = await createCo2Split(db, context, leaseId('weber'), {
			year: Y - 1,
			fuel: 'gas',
			fuelKwh: weberKwh,
			co2Kg: weberCo2,
			co2Cost: Math.round((weberCo2 / 1000) * byYear(CO2_PRICE, Y - 1) * 1.19 * 100),
			area: unitOf(unitId('Wohnung 9')).floorArea!,
			invoiceDate: soFar(at(0, '02-24')),
			claimedOn: soFar(at(0, '04-14'))
		});
		if (!split.ok) throw new Error(`CO₂-Kostenaufteilung: ${split.reason}`);

		// Documents to open in the preview: Berger's signed Mietvertrag and Übergabeprotokoll, and
		// the Grundsteuerbescheid of every past year as the receipt of the Lindenstraße's Beleg.
		const landlord = addressLines(await landlordAddress(db, accountId));
		const berger = ['Frau Lena Berger', 'Lindenstraße 12', '10969 Berlin'];
		const moveIn = at(-7, '01-01');
		const letter = (
			sender: string[],
			recipient: string[],
			day: IsoDate,
			subject: string,
			paragraphs: string[]
		) =>
			renderLetter({
				sender,
				recipient,
				date: `Berlin, ${formatDate(day)}`,
				subject,
				paragraphs,
				closing: ['Mit freundlichen Grüßen', '', sender[0]]
			});
		const files = [
			{
				name: 'Mietvertrag Berger (unterschrieben).pdf',
				links: { leaseId: leaseId('berger') },
				bytes: await letter(
					landlord,
					berger,
					at(-8, '11-24'),
					'Mietvertrag über die Wohnung 1. OG und Stellplatz 1',
					[
						`Mietbeginn ist der ${formatDate(moveIn)}. Die Kaltmiete beträgt 848,00 € einschließlich 50,00 € für den Stellplatz, dazu Vorauszahlungen von 160,00 € auf die Betriebskosten und 90,00 € auf die Heizkosten.`,
						'Die Kaution beträgt 2.544,00 € und kann in drei Raten gezahlt werden (§ 551 BGB).',
						'Beide Seiten haben den Vertrag am selben Tag unterschrieben; das Original liegt im Ordner der Lindenstraße 12.'
					]
				)
			},
			{
				name: 'Übergabeprotokoll Einzug Berger.pdf',
				links: { leaseId: leaseId('berger') },
				bytes: await letter(landlord, berger, moveIn, 'Übergabeprotokoll Wohnung 1. OG', [
					'Übergeben wurden drei Wohnungsschlüssel, zwei Haustürschlüssel, ein Briefkastenschlüssel und eine Fernbedienung für den Stellplatz.',
					'Zählerstände bei Übergabe: Strom 18.342 kWh, Wasser kalt 412,6 m³, Wasser warm 198,3 m³.',
					'Die Wohnung ist frisch renoviert; im Bad ist eine kleine Absplitterung an der Wanne vermerkt.'
				])
			},
			...(await Promise.all(
				[...lindenGrundsteuer].map(async ([year, costItemId]) => ({
					name: `Grundsteuerbescheid ${year} Lindenstraße 12.pdf`,
					links: { propertyId: lindenId, costItemId },
					bytes: await letter(
						[cities[lindenId], 'Steuerverwaltung', '10958 Berlin'],
						landlord,
						at(year - Y, '01-10'),
						`Grundsteuerbescheid ${year} für das Grundstück Lindenstraße 12`,
						[
							`Die Grundsteuer für ${year} wird auf ${formatCents(grundsteuerOf(lindenId, year))} festgesetzt.`,
							'Sie ist zu je einem Viertel am 15.02., 15.05., 15.08. und 15.11. fällig.'
						]
					)
				}))
			))
		];
		for (const file of files) {
			const stored = await storeDocument(
				db,
				context,
				{ ...file, mimeType: 'application/pdf' },
				options
			);
			if (!stored.ok) throw new Error(`Dokument ${file.name}: ${stored.reason}`);
			documentIds.push(stored.id);
		}
	} catch (error) {
		for (const id of documentIds) await deleteDocument(db, context, id, options);
		const ids = (rows: { id?: string }[]) => chunkIds(rows.map((row) => row.id!));
		const propertyIds = propertyRows.map((row) => row.id);
		await runBatch(db, [
			db
				.delete(operatingCostStatements)
				.where(inArray(operatingCostStatements.propertyId, propertyIds)),
			...ids(expenseRows).map((group) => db.delete(expenses).where(inArray(expenses.id, group))),
			db.delete(leases).where(
				inArray(
					leases.id,
					leaseEntries.map((entry) => entry.id)
				)
			),
			db.delete(tenants).where(
				inArray(
					tenants.id,
					tenantRows.map((row) => row.id)
				)
			),
			db.delete(bankAccounts).where(inArray(bankAccounts.id, [bankAccount.id, reserveAccount.id])),
			db.delete(tasks).where(
				inArray(
					tasks.id,
					taskRows.map((row) => row.id)
				)
			),
			db.delete(properties).where(inArray(properties.id, propertyIds))
		]);
		throw error;
	}

	return { ok: true, leases: plans.length };
}
