import { and, asc, eq } from 'drizzle-orm';
import { formatDate, type IsoDate } from '../dates';
import { formatCentsPlain } from '../money';
import { unitKindLabels } from '../units';
import type { Database } from './db';
import {
	leaseTenants,
	leases,
	payments,
	properties,
	rentCharges,
	tenants,
	units
} from './db/schema';
import { importFields, type ImportKind } from './import';

// The readable copy in the export ZIP (tabellen/*.csv): the main records as spreadsheets with
// the columns of the CSV import, so a landlord opens them in Excel, and a file imports into
// mietkartei (or anything that reads CSV) as it is. Values are written the way the import reads
// them: German dates and amounts, the German words of the kinds. export.json stays the complete
// copy; these leave out what the import has no column for, such as rent changes.

export type ReadableTable = {
	/** The path in the ZIP. */
	file: string;
	/** The import kind whose columns the file has. */
	kind: ImportKind;
	rows: (db: Database, accountId: string) => Promise<string[][]>;
};

const date = (value: string | null) => (value ? formatDate(value as IsoDate) : '');
const amount = (cents: number) => formatCentsPlain(cents);
const text = (value: string | null | undefined) => value ?? '';

/** The import accepts these words for the kinds and models (see import.ts). */
const leaseKindWords = { residential: 'Wohnraum', commercial: 'Gewerbe', parking: 'Stellplatz' };
const operatingCostModelWords = {
	prepayment: 'Vorauszahlung',
	flat: 'Pauschale',
	inclusive: 'Inklusive'
};
const heatingCostModelWords = {
	prepayment: 'Vorauszahlung',
	flat: 'Pauschale',
	tenant_contract: 'Direkt'
};

/**
 * The parties of each lease, with the token the import finds each by: `Nachname, Vorname`, or
 * the e-mail address when another tenant of the account has the same name and the address is
 * that tenant's alone.
 */
async function partiesOfLeases(db: Database, accountId: string) {
	const all = await db
		.select({
			id: tenants.id,
			firstName: tenants.firstName,
			lastName: tenants.lastName,
			email: tenants.email
		})
		.from(tenants)
		.where(eq(tenants.accountId, accountId));
	const tally = (keys: string[]) => {
		const counts = new Map<string, number>();
		for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
		return counts;
	};
	const nameOf = (tenant: (typeof all)[number]) =>
		`${tenant.lastName}, ${tenant.firstName}`.toLowerCase();
	const emailOf = (tenant: (typeof all)[number]) => tenant.email?.trim().toLowerCase() ?? '';
	const names = tally(all.map(nameOf));
	const emails = tally(all.map(emailOf));
	const tokens = new Map(
		all.map((tenant) => {
			const unique = names.get(nameOf(tenant)) === 1;
			const email = emailOf(tenant);
			const token =
				!unique && email && emails.get(email) === 1
					? tenant.email!.trim()
					: `${tenant.lastName}, ${tenant.firstName}`;
			return [tenant.id, token];
		})
	);

	const rows = await db
		.select({
			leaseId: leaseTenants.leaseId,
			tenantId: tenants.id,
			lastName: tenants.lastName
		})
		.from(leaseTenants)
		.innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
		.where(eq(tenants.accountId, accountId))
		.orderBy(asc(tenants.lastName), asc(tenants.firstName));
	const parties = new Map<string, ((typeof rows)[number] & { token: string })[]>();
	for (const row of rows) {
		const party = { ...row, token: tokens.get(row.tenantId)! };
		parties.set(row.leaseId, [...(parties.get(row.leaseId) ?? []), party]);
	}
	return parties;
}

async function leaseRows(db: Database, accountId: string) {
	return db
		.select({
			lease: leases,
			unitName: units.name,
			propertyName: properties.name
		})
		.from(leases)
		.innerJoin(units, eq(units.id, leases.unitId))
		.innerJoin(properties, eq(properties.id, units.propertyId))
		.where(eq(leases.accountId, accountId))
		.orderBy(asc(properties.name), asc(units.name), asc(leases.startDate));
}

/** The parties of a lease with its main tenant first, as the import takes the first as main. */
function mainFirst<T extends { tenantId: string }>(parties: T[], mainTenantId: string | null): T[] {
	const main = parties.find((party) => party.tenantId === mainTenantId);
	return main ? [main, ...parties.filter((party) => party !== main)] : parties;
}

export const readableTables: readonly ReadableTable[] = [
	{
		file: 'tabellen/objekte-und-einheiten.csv',
		kind: 'properties',
		rows: async (db, accountId) => {
			const rows = await db
				.select({ property: properties, unit: units })
				.from(units)
				.innerJoin(properties, eq(properties.id, units.propertyId))
				.where(eq(units.accountId, accountId))
				.orderBy(asc(properties.name), asc(units.name));
			return rows.map(({ property, unit }) => [
				property.name,
				property.street,
				property.postalCode,
				property.city,
				unit.name,
				unitKindLabels[unit.kind],
				unit.floorArea === null ? '' : String(unit.floorArea).replace('.', ',')
			]);
		}
	},
	{
		file: 'tabellen/mieter.csv',
		kind: 'tenants',
		rows: async (db, accountId) => {
			const rows = await db
				.select()
				.from(tenants)
				.where(eq(tenants.accountId, accountId))
				.orderBy(asc(tenants.lastName), asc(tenants.firstName));
			return rows.map((tenant) => [
				text(tenant.salutation),
				tenant.firstName,
				tenant.lastName,
				date(tenant.birthDate),
				text(tenant.email),
				text(tenant.phone),
				text(tenant.street),
				text(tenant.postalCode),
				text(tenant.city),
				text(tenant.notes)
			]);
		}
	},
	{
		file: 'tabellen/mietvertraege.csv',
		kind: 'leases',
		rows: async (db, accountId) => {
			const rows = await leaseRows(db, accountId);
			const parties = await partiesOfLeases(db, accountId);
			const openings = await db
				.select({ leaseId: rentCharges.leaseId, amount: rentCharges.amount })
				.from(rentCharges)
				.where(
					and(
						eq(rentCharges.accountId, accountId),
						eq(rentCharges.kind, 'adjustment'),
						eq(rentCharges.note, 'Anfangssaldo')
					)
				);
			const opening = new Map<string, number>();
			for (const row of openings) {
				opening.set(row.leaseId, (opening.get(row.leaseId) ?? 0) + row.amount);
			}
			return rows.map(({ lease, unitName, propertyName }) => [
				propertyName,
				unitName,
				mainFirst(parties.get(lease.id) ?? [], lease.mainTenantId)
					.map((party) => party.token)
					.join('; '),
				date(lease.startDate),
				date(lease.endDate),
				leaseKindWords[lease.kind],
				amount(lease.baseRent),
				amount(lease.operatingCostPrepayment),
				amount(lease.heatingCostPrepayment),
				amount(lease.securityDeposit),
				String(lease.persons),
				operatingCostModelWords[lease.operatingCostModel],
				heatingCostModelWords[lease.heatingCostModel],
				date(lease.ledgerStart),
				opening.has(lease.id) ? amount(opening.get(lease.id)!) : '',
				text(lease.notes)
			]);
		}
	},
	{
		file: 'tabellen/zahlungen.csv',
		kind: 'payments',
		rows: async (db, accountId) => {
			const leaseList = await leaseRows(db, accountId);
			const parties = await partiesOfLeases(db, accountId);
			const byLease = new Map(leaseList.map((row) => [row.lease.id, row]));
			const rows = await db
				.select({
					leaseId: payments.leaseId,
					date: payments.date,
					amount: payments.amount,
					note: payments.note
				})
				.from(payments)
				// Every payment belongs to a lease of the account; no list of lease ids is bound,
				// which D1 would refuse beyond 100 parameters.
				.where(eq(payments.accountId, accountId))
				.orderBy(asc(payments.date));
			return rows.map((payment) => {
				const lease = byLease.get(payment.leaseId)!;
				const [main] = mainFirst(parties.get(payment.leaseId) ?? [], lease.lease.mainTenantId);
				return [
					lease.propertyName,
					lease.unitName,
					text(main?.lastName),
					date(payment.date),
					amount(payment.amount),
					text(payment.note)
				];
			});
		}
	}
];

const cell = (value: string) =>
	/[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** One readable table as CSV text: a byte order mark, so Excel reads UTF-8, and CRLF lines. */
export async function readableCsv(db: Database, accountId: string, table: ReadableTable) {
	const header = importFields[table.kind].map((field) => field.label);
	const rows = await table.rows(db, accountId);
	for (const row of rows) {
		if (row.length !== header.length) throw new Error(`${table.file}: row does not fit the header`);
	}
	return '﻿' + [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
