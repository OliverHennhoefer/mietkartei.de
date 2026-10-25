import { and, eq } from 'drizzle-orm';
import type { IsoDate } from '../dates';
import { forecast, type Forecast } from '../domain/forecast';
import type { LeaseStatement } from '../domain/statement';
import { currentIndexValues } from './consumer-price-index';
import type { Database } from './db';
import { expenses, operatingCostStatements, rentChanges, statementResults } from './db/schema';
import { leaseLabel, listLeases } from './leases';

// Loads the rows of the Prognose: the leases with their rent history, the VPI, the expenses of
// the last year and the latest approved statement of each lease.

export type ForecastPage = Forecast & { propertyOptions: { id: string; name: string }[] };

export async function loadForecast(
	db: Database,
	accountId: string,
	options: { propertyId: string | null; today: IsoDate }
): Promise<ForecastPage> {
	const [leaseRows, changeRows, indexValues, expenseRows, resultRows] = await Promise.all([
		listLeases(db, accountId),
		db.select().from(rentChanges).where(eq(rentChanges.accountId, accountId)),
		currentIndexValues(db),
		db
			.select({
				date: expenses.date,
				amount: expenses.amount,
				category: expenses.category,
				propertyId: expenses.propertyId
			})
			.from(expenses)
			.where(eq(expenses.accountId, accountId)),
		db
			.select({
				leaseId: statementResults.leaseId,
				periodEnd: operatingCostStatements.periodEnd,
				version: operatingCostStatements.version,
				balance: statementResults.balance,
				result: statementResults.result
			})
			.from(statementResults)
			.innerJoin(
				operatingCostStatements,
				eq(operatingCostStatements.id, statementResults.statementId)
			)
			.where(
				and(
					eq(statementResults.accountId, accountId),
					eq(operatingCostStatements.status, 'approved')
				)
			)
	]);

	// The latest statement of each lease; a correction replaces the version before.
	const latest = new Map<string, (typeof resultRows)[number]>();
	for (const row of resultRows) {
		const seen = latest.get(row.leaseId);
		const newer =
			!seen ||
			row.periodEnd > seen.periodEnd ||
			(row.periodEnd === seen.periodEnd && row.version > seen.version);
		if (newer) latest.set(row.leaseId, row);
	}
	const statements = [...latest.values()].map((row) => {
		const result = JSON.parse(row.result) as LeaseStatement;
		return {
			leaseId: row.leaseId,
			periodEnd: row.periodEnd,
			costs: result.costsTotal,
			days: result.occupancy.days,
			balance: row.balance
		};
	});

	const properties = new Map(leaseRows.map((lease) => [lease.property.id, lease.property.name]));
	const result = forecast(
		{
			today: options.today,
			leases: leaseRows.map((lease) => ({
				...lease,
				label: `${leaseLabel(lease)}${
					lease.tenants.length
						? ` (${lease.tenants.map((tenant) => tenant.lastName).join(', ')})`
						: ''
				}`,
				propertyId: lease.property.id,
				changes: changeRows.filter((row) => row.leaseId === lease.id)
			})),
			indexValues,
			expenses: expenseRows,
			statements
		},
		{ propertyId: options.propertyId }
	);
	return {
		...result,
		propertyOptions: [...properties]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name, 'de'))
	};
}
