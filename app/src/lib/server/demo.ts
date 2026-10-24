import { count, eq, sql, type Table } from 'drizzle-orm';
import {
	addDays,
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	formatDate,
	monthOf,
	monthsInRange,
	today
} from '../dates';
import { fingerprintRows, formatIban, type BankRow } from '../domain/bank-matching';
import { formatCents } from '../money';
import type { UnitKind } from '../units';
import type { AuditContext } from './audit';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import {
	auditLog,
	bankAccounts,
	bankTransactions,
	costItems,
	depositTransactions,
	expenses,
	payments,
	properties,
	tasks,
	taxYears,
	tenants,
	units
} from './db/schema';
import { signedDepositAmount } from './deposits';
import { newLeaseStatements, type LeaseInput } from './leases';
import { ensureDefaults, listCategories, listKeys } from './operating-costs';
import { assertQuota, type QuotaKind } from './quotas';
import type { TenantInput } from './tenants';

// Demo data for an empty account: two properties with six units,
// five tenants, four running leases and one ended, two years of rent payments, one lease two
// months in arrears, a bank account with open transactions, last year's cost items, two years of
// expenses and two tasks. Everything is written in one batch with the rows and audit lines the features' own
// functions write, so the audit log and the ledger look like real use and a failure leaves the
// account empty. The names read like a small real portfolio; nothing marks them as demo rows,
// so the landlord deletes them with the account (Einstellungen → Konto).

export type DemoResult = { ok: true; leases: number } | { ok: false; reason: 'not-empty' };

const RENT_DAY = 2; // paid on the 3rd of the month

function tenant(firstName: string, lastName: string, email: string | null): TenantInput {
	return {
		salutation: null,
		firstName,
		lastName,
		email,
		phone: null,
		street: null,
		postalCode: null,
		city: null,
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

/** Whether the account holds no property yet; the demo button is only offered then. */
export async function isEmptyAccount(db: Database, accountId: string): Promise<boolean> {
	const [row] = await db
		.select({ count: count() })
		.from(properties)
		.where(eq(properties.accountId, accountId));
	return row.count === 0;
}

export async function createDemoData(db: Database, context: AuditContext): Promise<DemoResult> {
	const { accountId } = context;
	if (!(await isEmptyAccount(db, accountId))) return { ok: false, reason: 'not-empty' };
	const date = today();
	const lastMonth = addMonthsToMonth(monthOf(date), -1);

	// Reads and idempotent seeding first; everything else is written in one batch below, so a
	// failure leaves the account empty and the button offers the demo again.
	await ensureDefaults(db, accountId);
	const categories = await listCategories(db, accountId);
	const keys = await listKeys(db, accountId);

	// Properties and units.
	const lindenId = crypto.randomUUID();
	const gartenId = crypto.randomUUID();
	const propertyRows = [
		{
			id: lindenId,
			accountId,
			name: 'Lindenstraße 12',
			street: 'Lindenstraße 12',
			postalCode: '10115',
			city: 'Berlin',
			acquisitionDate: '2015-07-01',
			acquisitionCost: 850_000_00,
			buildingShare: 75,
			depreciationRate: 2
		},
		{
			id: gartenId,
			accountId,
			name: 'Gartenweg 3',
			street: 'Gartenweg 3',
			postalCode: '14467',
			city: 'Potsdam',
			acquisitionDate: '2019-04-01',
			acquisitionCost: 420_000_00,
			buildingShare: 70,
			depreciationRate: 2
		}
	];
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
			propertyId: gartenId,
			name: 'Wohnung EG',
			kind: 'apartment',
			floorArea: 84,
			floor: 'EG',
			rooms: 3
		},
		{
			propertyId: gartenId,
			name: 'Wohnung DG',
			kind: 'apartment',
			floorArea: 55,
			floor: 'DG',
			rooms: 2
		}
	].map((row) => ({ id: crypto.randomUUID(), accountId, ...row, kind: row.kind as UnitKind }));
	const unitId = (name: string) => unitRows.find((row) => row.name === name)!.id;

	// Tenants.
	const tenantInputs = {
		schmidt: tenant('Anna', 'Schmidt', 'anna.schmidt@example.org'),
		yilmaz: tenant('Murat', 'Yılmaz', 'murat.yilmaz@example.org'),
		berger: tenant('Lena', 'Berger', 'lena.berger@example.org'),
		nowak: tenant('Tomasz', 'Nowak', 'tomasz.nowak@example.org'),
		kraus: tenant('Helga', 'Kraus', null)
	};
	const tenantRows = Object.values(tenantInputs).map((input) => ({
		id: crypto.randomUUID(),
		accountId,
		...input
	}));
	const tenantIds = Object.fromEntries(
		Object.keys(tenantInputs).map((key, index) => [key, tenantRows[index].id])
	) as Record<keyof typeof tenantInputs, string>;

	// Leases: four running, one ended (the previous tenant of EG rechts).
	const inputs: { key: string; input: LeaseInput }[] = [
		{
			key: 'schmidt',
			input: lease(unitId('Wohnung EG links'), [tenantIds.schmidt], {
				startDate: '2023-04-01',
				baseRent: 62000,
				operatingCostPrepayment: 13000,
				heatingCostPrepayment: 6000,
				securityDeposit: 186000
			})
		},
		{
			key: 'kraus',
			input: lease(unitId('Wohnung EG rechts'), [tenantIds.kraus], {
				startDate: '2019-09-01',
				endDate: '2024-08-31',
				baseRent: 52000,
				operatingCostPrepayment: 11000,
				heatingCostPrepayment: 5000,
				securityDeposit: 156000,
				persons: 1,
				terminatedAt: '2024-05-28',
				terminatedBy: 'tenant'
			})
		},
		{
			key: 'yilmaz',
			input: lease(unitId('Wohnung EG rechts'), [tenantIds.yilmaz], {
				startDate: '2024-10-01',
				rentModel: 'indexed',
				indexBaseMonth: '2024-09',
				indexBaseValue: 119.7,
				baseRent: 64000,
				operatingCostPrepayment: 12000,
				heatingCostPrepayment: 5500,
				securityDeposit: 192000,
				persons: 1
			})
		},
		{
			key: 'berger',
			input: lease(unitId('Wohnung 1. OG'), [tenantIds.berger], {
				extraUnitIds: [unitId('Stellplatz 1')],
				startDate: '2022-01-01',
				baseRent: 83000,
				operatingCostPrepayment: 16000,
				heatingCostPrepayment: 7500,
				securityDeposit: 249000,
				persons: 3
			})
		},
		{
			key: 'nowak',
			input: lease(unitId('Wohnung EG'), [tenantIds.nowak], {
				startDate: '2025-06-01',
				baseRent: 92000,
				operatingCostPrepayment: 18000,
				heatingCostPrepayment: 8000,
				securityDeposit: 276000,
				persons: 2
			})
		}
	];
	// Only the last two years are booked: an older lease starts its ledger there, so the months
	// before are neither charged nor paid.
	const firstBookedMonth = addMonthsToMonth(monthOf(date), -24);
	for (const { input } of inputs) {
		if (monthOf(input.startDate) < firstBookedMonth)
			input.ledgerStart = firstOfMonth(firstBookedMonth);
	}
	const leaseEntries = inputs.map(({ key, input }) => ({ key, id: crypto.randomUUID(), input }));
	const leaseId = (key: string) => leaseEntries.find((entry) => entry.key === key)!.id;

	// Deposits received at the start, and the rent paid month by month until last month (the
	// current month is open on the bank account below). Berger has not paid the two months before:
	// the arrears tile. Kraus got her deposit back after moving out.
	const depositRows = [
		...leaseEntries.map(({ id, input }) => ({
			leaseId: id,
			date: input.startDate,
			kind: 'received' as const,
			amount: input.securityDeposit,
			note: 'Überweisung bei Vertragsbeginn'
		})),
		{
			leaseId: leaseId('kraus'),
			date: '2024-11-15',
			kind: 'returned' as const,
			amount: 156000,
			note: 'Rückzahlung nach Auszug'
		}
	].map((row) => ({
		id: crypto.randomUUID(),
		accountId,
		...row,
		amount: signedDepositAmount(row.kind, row.amount),
		bankTransactionId: null
	}));
	const paymentRows = leaseEntries.flatMap(({ key, id, input }) => {
		const total = input.baseRent + input.operatingCostPrepayment + input.heatingCostPrepayment;
		const from =
			monthOf(input.startDate) > firstBookedMonth ? monthOf(input.startDate) : firstBookedMonth;
		const to = input.endDate ? monthOf(input.endDate) : lastMonth;
		if (from > to) return [];
		let months = monthsInRange(from, to);
		if (key === 'berger') months = months.slice(0, -2);
		return months.map((month) => ({
			id: crypto.randomUUID(),
			accountId,
			leaseId: id,
			date: addDays(firstOfMonth(month), RENT_DAY),
			amount: total,
			source: 'manual' as const,
			bankTransactionId: null,
			note: `Miete ${month}`
		}));
	});

	// A bank account with this month's transactions, none assigned yet: the open transactions tile.
	const bankAccount = {
		id: crypto.randomUUID(),
		accountId,
		name: 'Mietkonto Sparkasse',
		iban: 'DE02120300000000202051',
		bic: 'BYLADEM1001',
		holder: 'Vermietung Lindenstraße'
	};
	const thisMonth = firstOfMonth(monthOf(date));
	const bankRows: BankRow[] = [
		{
			bookingDate: addDays(thisMonth, 2),
			valueDate: addDays(thisMonth, 2),
			amount: 81000,
			counterpartName: 'Anna Schmidt',
			counterpartIban: 'DE89370400440532013000',
			purpose: `Miete ${monthOf(date)} Lindenstr. 12 EG links`,
			externalId: null
		},
		{
			bookingDate: addDays(thisMonth, 2),
			valueDate: addDays(thisMonth, 2),
			amount: 81500,
			counterpartName: 'Murat Yilmaz',
			counterpartIban: 'DE27100777770209299700',
			purpose: 'Miete EG rechts',
			externalId: null
		},
		{
			bookingDate: addDays(thisMonth, 4),
			valueDate: addDays(thisMonth, 4),
			amount: -24500,
			counterpartName: 'Stadtwerke Potsdam',
			counterpartIban: 'DE12500105170648489890',
			purpose: 'Abschlag Wasser Gartenweg 3',
			externalId: null
		}
	];
	const transactionRows = (await fingerprintRows(bankRows)).map((row) => ({
		id: crypto.randomUUID(),
		accountId,
		bankAccountId: bankAccount.id,
		importId: null,
		...row
	}));

	// Last year's cost items for Lindenstraße 12 on the standard categories and keys.
	const lastYear = String(Number(date.slice(0, 4)) - 1);
	const items: [string, string, string, number][] = [
		['Grundsteuer', 'Grundsteuerbescheid', 'Finanzamt Berlin', 98400],
		['Wasserversorgung', 'Wasser und Abwasser', 'Berliner Wasserbetriebe', 187250],
		['Straßenreinigung und Müllbeseitigung', 'Müllabfuhr', 'BSR', 96000],
		['Sach- und Haftpflichtversicherung', 'Gebäudeversicherung', 'Allianz', 142300],
		['Hauswart', 'Hausmeisterdienst', 'Hausmeisterservice Krüger', 180000]
	];
	const costItemRows = items.flatMap(([categoryName, description, supplier, amount]) => {
		const category = categories.find((row) => row.name === categoryName);
		const keyId = category?.allocationKeyId ?? keys[0]?.id;
		if (!category || !keyId) return [];
		return [
			{
				id: crypto.randomUUID(),
				accountId,
				propertyId: lindenId,
				categoryId: category.id,
				allocationKeyId: keyId,
				billingCircleId: null,
				description,
				supplier,
				invoiceDate: `${lastYear}-12-15`,
				periodStart: `${lastYear}-01-01`,
				periodEnd: `${lastYear}-12-31`,
				amount,
				allocable: true
			}
		];
	});

	// Two years of expenses: the monthly loan rates, last year's operating costs as paid, a few
	// repairs on single units and the tax adviser, so the analysis has something to compare.
	const expense = (
		day: string,
		amount: number,
		category: (typeof expenses.$inferInsert)['category'],
		description: string,
		propertyId: string | null,
		unit: string | null = null
	) => ({
		id: crypto.randomUUID(),
		accountId,
		propertyId,
		unitId: unit ? unitId(unit) : null,
		date: day,
		amount,
		category,
		description
	});
	const expenseRows = [
		...monthsInRange(firstBookedMonth, lastMonth).flatMap((month) => [
			expense(
				addDays(firstOfMonth(month), 14),
				95000,
				'loan_payment',
				'Darlehensrate Sparkasse',
				lindenId
			),
			expense(
				addDays(firstOfMonth(month), 14),
				62000,
				'loan_payment',
				'Darlehensrate KfW',
				gartenId
			)
		]),
		...costItemRows.map((item) =>
			expense(`${lastYear}-03-15`, item.amount, 'operating_costs', item.description, lindenId)
		),
		expense(
			addMonths(date, -14),
			124000,
			'maintenance',
			'Heizungsreparatur',
			gartenId,
			'Wohnung EG'
		),
		expense(addMonths(date, -9), 215000, 'maintenance', 'Malerarbeiten', gartenId, 'Wohnung DG'),
		expense(
			addMonths(date, -3),
			318000,
			'maintenance',
			'Wasserschaden Bad',
			lindenId,
			'Wohnung 1. OG'
		),
		expense(addMonths(date, -6), 89000, 'modernization', 'Rauchmelder, alle Wohnungen', lindenId),
		expense(`${lastYear}-05-20`, 69000, 'management', 'Steuerberatung Anlage V', null)
	];

	// Two tasks.
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
			note: 'Jährliche Wartung, alle Wohnungen.'
		},
		{
			id: crypto.randomUUID(),
			accountId,
			title: 'Mahnung schreiben',
			dueDate: addDays(date, 7),
			propertyId: null,
			leaseId: leaseId('berger'),
			note: 'Zwei Monatsmieten offen.'
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
		...costItemRows.map((item) =>
			audit(
				'cost_item',
				item.id,
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
		['bankAccounts', 1],
		['bankTransactions', transactionRows.length],
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
			...insert(depositTransactions, depositRows),
			...insert(payments, paymentRows),
			...insert(bankAccounts, [bankAccount]),
			...insert(bankTransactions, transactionRows),
			...insert(costItems, costItemRows),
			...insert(expenses, expenseRows),
			...insert(tasks, taskRows),
			// The interest of last year's Darlehensraten, as the bank's Zinsbescheinigung would say.
			...insert(taxYears, [
				{ accountId, propertyId: lindenId, year: Number(lastYear), loanInterest: 4_920_00 },
				{ accountId, propertyId: gartenId, year: Number(lastYear), loanInterest: 2_870_00 }
			]),
			...insert(auditLog, auditRows),
			// The last line is also the guard against a second run at the same time (a double
			// click): both pass isEmptyAccount, but once one batch is in, the other sees four
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
	return { ok: true, leases: inputs.length };
}
