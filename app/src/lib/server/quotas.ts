import { error } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Database } from './db';
import {
	allocationKeys,
	bankAccounts,
	billingCircles,
	bankTransactions,
	co2CostSplits,
	consumerPriceIndex,
	costCategories,
	costItems,
	depositTransactions,
	emailChanges,
	invitations,
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
	tenants,
	units
} from './db/schema';

// Upper limits per account. A private landlord stays far below every one of them; they exist so
// that a script with one account cannot fill the shared hosted database, whose every list query
// and its cost grow with the rows of the account. Each check is one count over an indexed column.

type Quota = { table: SQLiteTable & { accountId: SQLiteColumn }; max: number; label: string };

export const QUOTAS = {
	properties: { table: properties, max: 500, label: 'Objekte' },
	units: { table: units, max: 5_000, label: 'Einheiten' },
	tenants: { table: tenants, max: 10_000, label: 'Mieter' },
	leases: { table: leases, max: 10_000, label: 'Mietverträge' },
	leasePersons: { table: leasePersons, max: 20_000, label: 'Einträge zur Personenzahl' },
	depositTransactions: { table: depositTransactions, max: 20_000, label: 'Kautionsbuchungen' },
	payments: { table: payments, max: 200_000, label: 'Zahlungen' },
	/** Mostly the monthly rent charges, which every lease generates on its own. */
	rentCharges: { table: rentCharges, max: 1_000_000, label: 'Sollstellungen' },
	rentChanges: { table: rentChanges, max: 50_000, label: 'Mietänderungen' },
	consumerPriceIndex: { table: consumerPriceIndex, max: 2_000, label: 'VPI-Werte' },
	bankAccounts: { table: bankAccounts, max: 50, label: 'Bankverbindungen' },
	matchingRules: { table: matchingRules, max: 2_000, label: 'Zuordnungsregeln' },
	bankTransactions: { table: bankTransactions, max: 100_000, label: 'Bankumsätze' },
	costCategories: { table: costCategories, max: 200, label: 'Kostenarten' },
	/** Also bounds the shares: one per unit of the key's property. */
	allocationKeys: { table: allocationKeys, max: 200, label: 'Umlageschlüssel' },
	/** Also bounds the circle units: at most the units of the circle's property. */
	billingCircles: { table: billingCircles, max: 200, label: 'Abrechnungskreise' },
	meters: { table: meters, max: 20_000, label: 'Zähler' },
	meterReadings: { table: meterReadings, max: 500_000, label: 'Zählerstände' },
	/** Also bounds the unit amounts: one per unit of the item's property. */
	costItems: { table: costItems, max: 100_000, label: 'Belege' },
	operatingCostStatements: {
		table: operatingCostStatements,
		max: 10_000,
		label: 'Betriebskostenabrechnungen'
	},
	/** One per lease and approved statement. */
	statementResults: { table: statementResults, max: 200_000, label: 'Abrechnungsergebnisse' },
	/** One per lease and year. */
	co2CostSplits: { table: co2CostSplits, max: 50_000, label: 'CO₂-Kostenaufteilungen' },
	tasks: { table: tasks, max: 20_000, label: 'Aufgaben' },
	/** Accepted, expired and revoked invitations stay, so this also bounds the users of an account. */
	invitations: { table: invitations, max: 500, label: 'Einladungen' },
	/** Requests to change an email address; each user may make five a day. */
	emailChanges: { table: emailChanges, max: 5_000, label: 'Änderungen der E-Mail-Adresse' }
} satisfies Record<string, Quota>;

export type QuotaKind = keyof typeof QUOTAS;

/** How many rows of the kind the account has. */
export async function usage(db: Database, accountId: string, kind: QuotaKind): Promise<number> {
	const { table } = QUOTAS[kind] as Quota;
	const [row] = await db
		.select({ value: count() })
		.from(table)
		.where(eq(table.accountId, accountId));
	return row.value;
}

/**
 * Refuses the request with 409 when `adding` more rows of the kind would take the account over
 * its limit. Thrown, not returned: hitting a limit is an abuse case, not a form error.
 */
export async function assertQuota(
	db: Database,
	accountId: string,
	kind: QuotaKind,
	adding = 1
): Promise<void> {
	const { max, label } = QUOTAS[kind];
	if ((await usage(db, accountId, kind)) + adding > max) {
		error(
			409,
			`Ein Konto fasst höchstens ${max.toLocaleString('de-DE')} ${label}. Diese Grenze ist erreicht.`
		);
	}
}
