import { and, eq, inArray, or } from 'drizzle-orm';
import { formatDate, monthOf, today } from '../dates';
import {
	FORM_YEAR,
	taxOverview,
	type TaxLeaseIncome,
	type TaxLine,
	type TaxOverview
} from '../domain/tax';
import { formatNumber, personName } from '../format';
import { formatCents, formatCentsPlain } from '../money';
import { unitKindLabels } from '../units';
import { addressLines, landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import type { Database } from './db';
import { chunkIds, runBatch } from './db/batch';
import {
	associationStatements,
	expenses,
	leaseTenants,
	leases,
	payments,
	properties,
	rentCharges,
	taxYears,
	tenants,
	units
} from './db/schema';
import { ensureCharges } from './ledger';
import type { PdfTable, Report } from './pdf';
import { assertQuota } from './quotas';

// Loads the rows of the Steuerübersicht of one property and year and hands them to the domain;
// keeps the figures the bookings do not hold (the AfA basis on the property, the interest of a
// year in tax_years) and builds the CSV and PDF for the Steuerberater.

export const DISCLAIMER =
	'Diese Übersicht ist eine Hilfe zum Ausfüllen der Anlage V und keine Steuerberatung. Sie beruht allein auf den Buchungen in mietkartei und ist vor der Abgabe zu prüfen, am besten mit einem Steuerberater.';

export type TaxLeaseRow = TaxLeaseIncome & { label: string };

export type TaxPage = Omit<TaxOverview, 'leases'> & {
	leases: TaxLeaseRow[];
	loanInterest: number | null;
	/** The years to choose from, newest first. */
	years: number[];
};

export type TaxPropertyRow = typeof properties.$inferSelect;

/** The years with bookings of the property, plus the current and the last one, newest first. */
function yearsOf(dates: readonly string[], current: number): number[] {
	const years = new Set([current, current - 1]);
	for (const date of dates) years.add(Number(date.slice(0, 4)));
	return [...years].filter((year) => year >= 1900 && year <= current).sort((a, b) => b - a);
}

export async function loadTaxOverview(
	db: Database,
	accountId: string,
	property: TaxPropertyRow,
	year: number
): Promise<TaxPage> {
	const unitRows = await db
		.select({ id: units.id, kind: units.kind, name: units.name })
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, property.id)));
	const unitIds = unitRows.map((unit) => unit.id);
	const leaseRows = unitIds.length
		? (
				await Promise.all(
					chunkIds(unitIds).map((ids) =>
						db
							.select({ id: leases.id, unitId: leases.unitId })
							.from(leases)
							.where(and(eq(leases.accountId, accountId), inArray(leases.unitId, ids)))
					)
				)
			).flat()
		: [];
	const leaseIds = leaseRows.map((lease) => lease.id);
	const currentMonth = monthOf(today());
	const lastMonth = `${year}-12`;
	await ensureCharges(db, accountId, leaseIds, lastMonth < currentMonth ? lastMonth : currentMonth);

	const byLease = <T>(query: (ids: string[]) => Promise<T[]>) =>
		leaseIds.length
			? Promise.all(chunkIds(leaseIds).map(query)).then((groups) => groups.flat())
			: Promise.resolve([] as T[]);
	const unitIdsOf = db
		.select({ id: units.id })
		.from(units)
		.where(and(eq(units.accountId, accountId), eq(units.propertyId, property.id)));

	const [chargeRows, paymentRows, tenantRows, expenseRows, statementRows, [taxYear]] =
		await Promise.all([
			byLease((ids) =>
				db
					.select({
						leaseId: rentCharges.leaseId,
						period: rentCharges.period,
						kind: rentCharges.kind,
						baseRent: rentCharges.baseRent,
						operatingCostPrepayment: rentCharges.operatingCostPrepayment,
						heatingCostPrepayment: rentCharges.heatingCostPrepayment,
						amount: rentCharges.amount
					})
					.from(rentCharges)
					.where(and(eq(rentCharges.accountId, accountId), inArray(rentCharges.leaseId, ids)))
			),
			byLease((ids) =>
				db
					.select({ leaseId: payments.leaseId, date: payments.date, amount: payments.amount })
					.from(payments)
					.where(and(eq(payments.accountId, accountId), inArray(payments.leaseId, ids)))
			),
			byLease((ids) =>
				db
					.select({
						leaseId: leaseTenants.leaseId,
						firstName: tenants.firstName,
						lastName: tenants.lastName
					})
					.from(leaseTenants)
					.innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
					.where(inArray(leaseTenants.leaseId, ids))
			),
			db
				.select({
					id: expenses.id,
					date: expenses.date,
					amount: expenses.amount,
					category: expenses.category,
					description: expenses.description
				})
				.from(expenses)
				.where(
					and(
						eq(expenses.accountId, accountId),
						or(eq(expenses.propertyId, property.id), inArray(expenses.unitId, unitIdsOf))
					)
				),
			db
				.select()
				.from(associationStatements)
				.where(
					and(
						eq(associationStatements.accountId, accountId),
						eq(associationStatements.propertyId, property.id)
					)
				),
			db
				.select({ loanInterest: taxYears.loanInterest })
				.from(taxYears)
				.where(
					and(
						eq(taxYears.accountId, accountId),
						eq(taxYears.propertyId, property.id),
						eq(taxYears.year, year)
					)
				)
		]);

	const loanInterest = taxYear?.loanInterest ?? null;
	const overview = taxOverview({
		year,
		property,
		units: unitRows,
		leases: leaseRows,
		charges: chargeRows,
		payments: paymentRows,
		expenses: expenseRows,
		associationStatements: statementRows,
		loanInterest
	});

	const unitName = new Map(unitRows.map((unit) => [unit.id, unit.name]));
	const leaseUnit = new Map(leaseRows.map((lease) => [lease.id, lease.unitId]));
	const names = new Map<string, string[]>();
	for (const row of tenantRows) {
		const list = names.get(row.leaseId);
		if (list) list.push(personName(row));
		else names.set(row.leaseId, [personName(row)]);
	}
	const leaseRowsLabelled = overview.leases
		.map((lease) => ({
			...lease,
			label: [
				unitName.get(leaseUnit.get(lease.leaseId) ?? ''),
				names.get(lease.leaseId)?.join(', ')
			]
				.filter(Boolean)
				.join(' · ')
		}))
		.sort((a, b) => a.label.localeCompare(b.label, 'de'));

	const years = yearsOf(
		[
			...paymentRows.map((row) => row.date),
			...expenseRows.map((row) => row.date),
			...(property.acquisitionDate ? [property.acquisitionDate] : [])
		],
		Number(today().slice(0, 4))
	);
	return { ...overview, leases: leaseRowsLabelled, loanInterest, years };
}

export type DepreciationInput = {
	acquisitionDate: string | null;
	acquisitionCost: number | null;
	buildingShare: number | null;
	depreciationRate: number | null;
};

/** Saves the AfA basis of the property; false when it does not exist in this account. */
export async function saveDepreciation(
	db: Database,
	context: AuditContext,
	propertyId: string,
	input: DepreciationInput
): Promise<boolean> {
	const { accountId } = context;
	const [property] = await db
		.select({ name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return false;
	await runBatch(db, [
		db
			.update(properties)
			.set(input)
			.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId))),
		auditEntry(
			db,
			context,
			'property',
			propertyId,
			'update',
			`Angaben zur AfA für Objekt ${property.name} geändert`
		)
	]);
	return true;
}

/** Saves the interest of the year from the Zinsbescheinigung; null removes it. */
export async function saveLoanInterest(
	db: Database,
	context: AuditContext,
	propertyId: string,
	year: number,
	loanInterest: number | null
): Promise<boolean> {
	const { accountId } = context;
	const [property] = await db
		.select({ name: properties.name })
		.from(properties)
		.where(and(eq(properties.accountId, accountId), eq(properties.id, propertyId)));
	if (!property) return false;
	const [existing] = await db
		.select({ id: taxYears.id })
		.from(taxYears)
		.where(
			and(
				eq(taxYears.accountId, accountId),
				eq(taxYears.propertyId, propertyId),
				eq(taxYears.year, year)
			)
		);
	if (!existing) await assertQuota(db, accountId, 'taxYears');
	const id = existing?.id ?? crypto.randomUUID();
	const summary =
		loanInterest === null
			? `Zinsen ${year} für Objekt ${property.name} entfernt`
			: `Zinsen ${year} für Objekt ${property.name}: ${formatCents(loanInterest)}`;
	await runBatch(db, [
		existing
			? db
					.update(taxYears)
					.set({ loanInterest })
					.where(and(eq(taxYears.accountId, accountId), eq(taxYears.id, id)))
			: db.insert(taxYears).values({ id, accountId, propertyId, year, loanInterest }),
		auditEntry(db, context, 'tax_year', id, existing ? 'update' : 'create', summary)
	]);
	return true;
}

/** `Steuer Lindenstraße 12 2025.csv`; the PDF takes the same name. */
export function taxFilename(property: { name: string }, year: number, extension: string): string {
	return `Anlage V ${property.name} ${year}.${extension}`;
}

const csvCell = (value: string) =>
	/[;"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/**
 * The overview as CSV for the Steuerberater or a spreadsheet: semicolons and decimal commas, as
 * German Excel expects, one row per amount with its line of the Anlage V.
 */
export function taxCsv(property: TaxPropertyRow, page: TaxPage): string {
	const rows: string[][] = [['Bereich', 'Zeile', 'Bezeichnung', 'Position', 'Betrag in EUR']];
	const lines = (section: string, list: TaxLine[]) => {
		for (const line of list) {
			for (const entry of line.entries) {
				rows.push([
					section,
					String(line.line),
					line.label,
					entry.label,
					formatCentsPlain(entry.amount)
				]);
			}
		}
	};
	lines('Einnahmen', page.income);
	rows.push(['Einnahmen', '32', 'Summe der Einnahmen', '', formatCentsPlain(page.incomeTotal)]);
	lines('Werbungskosten', page.costs);
	rows.push([
		'Werbungskosten',
		'83',
		'Summe der Werbungskosten',
		'',
		formatCentsPlain(page.costsTotal)
	]);
	rows.push(['Ergebnis', '85', 'Überschuss', '', formatCentsPlain(page.result)]);
	for (const item of page.nonDeductible) {
		rows.push(['Nicht abziehbar', '', item.label, item.reason, formatCentsPlain(item.amount)]);
	}
	const head = [
		[
			`Steuerübersicht ${page.year}`,
			`${property.name}, ${property.street}, ${property.postalCode} ${property.city}`
		],
		[`Zeilen nach der Anlage V ${FORM_YEAR}`],
		[DISCLAIMER],
		[]
	];
	// A byte order mark, so Excel reads the umlauts as UTF-8.
	return '﻿' + [...head, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function csvResponse(text: string, filename: string): Response {
	const fallback = filename.replace(/[^A-Za-z0-9 ._-]/g, '_');
	return new Response(text, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
			'Cache-Control': 'private, no-store'
		}
	});
}

function lineTable(title: string, list: TaxLine[], totalLabel: string, total: number): PdfTable {
	return {
		title,
		columns: [
			{ label: 'Zeile', width: 0.1 },
			{ label: 'Bezeichnung', width: 0.68 },
			{ label: 'Betrag', align: 'right', width: 0.22 }
		],
		rows: list.map((line) => [
			String(line.line),
			[
				line.label,
				...(line.entries.length > 1 || line.entries[0]?.label !== line.label
					? line.entries.map((entry) => `${entry.label}: ${formatCents(entry.amount)}`)
					: [])
			].join('\n'),
			formatCents(line.amount)
		]),
		footer: ['', totalLabel, formatCents(total)]
	};
}

/** The overview as a report for the Steuerberater. */
export async function taxReport(
	db: Database,
	accountId: string,
	property: TaxPropertyRow,
	page: TaxPage
): Promise<Report> {
	const landlord = addressLines(await landlordAddress(db, accountId)).join(', ');
	const blocks: Report['blocks'] = [
		{
			table: lineTable('Einnahmen', page.income, 'Summe der Einnahmen (Zeile 32)', page.incomeTotal)
		},
		{
			table: lineTable(
				'Werbungskosten',
				page.costs,
				'Summe der Werbungskosten (Zeile 83)',
				page.costsTotal
			)
		},
		{
			paragraph: `Überschuss (Zeile 85): ${formatCents(page.result)}${page.result < 0 ? ' (Verlust)' : ''}`
		}
	];
	if (page.depreciation) {
		const d = page.depreciation;
		blocks.push({
			paragraph: `AfA: Anschaffung am ${formatDate(property.acquisitionDate!)}, Anschaffungskosten ${formatCents(property.acquisitionCost!)}, davon Gebäude ${formatNumber(property.buildingShare!)} % = ${formatCents(d.base)}. ${formatNumber(property.depreciationRate!)} % im Jahr = ${formatCents(d.yearly)}; ${page.year} ${d.months} Monate = ${formatCents(d.amount)}. Restwert danach ${formatCents(d.remaining)}.`
		});
	}
	if (page.leases.length > 0) {
		blocks.push({
			table: {
				title: 'Einnahmen je Mietvertrag',
				columns: [
					{ label: 'Mietvertrag', width: 0.34 },
					{ label: 'Eingang', align: 'right', width: 0.16 },
					{ label: 'Kaltmiete', align: 'right', width: 0.16 },
					{ label: 'Umlagen', align: 'right', width: 0.17 },
					{ label: 'Abrechnung', align: 'right', width: 0.17 }
				],
				rows: page.leases.map((lease) => [
					`${lease.label} (${unitKindLabels[lease.unitKind]})${lease.prorated ? ' *' : ''}`,
					formatCents(lease.received),
					formatCents(lease.baseRent),
					formatCents(lease.prepayments),
					formatCents(lease.settlements + lease.other)
				])
			}
		});
	}
	if (page.nonDeductible.length > 0) {
		blocks.push({
			table: {
				title: 'Gebucht, aber nicht sofort abziehbar',
				columns: [
					{ label: 'Position', width: 0.4 },
					{ label: 'Grund', width: 0.4 },
					{ label: 'Betrag', align: 'right', width: 0.2 }
				],
				rows: page.nonDeductible.map((item) => [item.label, item.reason, formatCents(item.amount)])
			}
		});
	}
	for (const finding of page.findings) blocks.push({ paragraph: `Hinweis: ${finding.message}` });
	if (page.leases.some((lease) => lease.prorated)) {
		blocks.push({
			paragraph: '* Zahlungen weichen von den Sollstellungen ab, anteilig aufgeteilt.'
		});
	}
	blocks.push({ paragraph: DISCLAIMER });
	return {
		title: `Steuerübersicht ${page.year}: ${property.name}`,
		subtitle: [
			`${property.street}, ${property.postalCode} ${property.city}`,
			...(landlord ? [`Vermieter: ${landlord}`] : []),
			`Zeilen nach der Anlage V ${FORM_YEAR} · erstellt am ${formatDate(today())}`
		],
		blocks
	};
}
