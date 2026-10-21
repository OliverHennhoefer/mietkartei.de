import { count, eq } from 'drizzle-orm';
import {
	addDays,
	addMonths,
	addMonthsToMonth,
	firstOfMonth,
	monthOf,
	monthsInRange,
	today
} from '../dates';
import { fingerprintRows, type BankRow } from '../domain/bank-matching';
import { auditEntry, type AuditContext } from './audit';
import { createBankAccount } from './bank/accounts';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import { bankTransactions, properties, units } from './db/schema';
import { depositEntry } from './deposits';
import { paymentEntry } from './ledger';
import { createLease, type LeaseInput } from './leases';
import { createCostItem, ensureDefaults, listCategories, listKeys } from './operating-costs';
import { createTask } from './tasks';
import { createTenant, type TenantInput } from './tenants';

// Demo data for an empty account (PROTOTYPE.md, assumption 18): two properties with six units,
// five tenants, four running leases and one ended, two years of rent payments, one lease two
// months in arrears, a bank account with open transactions, last year's cost items and two
// tasks. Most rows go through the features' own functions, so the audit log and the ledger look
// like real use. The names read like a small real portfolio; nothing marks them as demo rows,
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

	// Properties and units.
	const [linden] = await db
		.insert(properties)
		.values({
			accountId,
			name: 'Lindenstraße 12',
			street: 'Lindenstraße 12',
			postalCode: '10115',
			city: 'Berlin'
		})
		.returning({ id: properties.id });
	const [garten] = await db
		.insert(properties)
		.values({
			accountId,
			name: 'Gartenweg 3',
			street: 'Gartenweg 3',
			postalCode: '14467',
			city: 'Potsdam'
		})
		.returning({ id: properties.id });
	const unitRows = await db
		.insert(units)
		.values([
			{
				accountId,
				propertyId: linden.id,
				name: 'Wohnung EG links',
				kind: 'apartment',
				floorArea: 62,
				floor: 'EG',
				rooms: 2
			},
			{
				accountId,
				propertyId: linden.id,
				name: 'Wohnung EG rechts',
				kind: 'apartment',
				floorArea: 58,
				floor: 'EG',
				rooms: 2
			},
			{
				accountId,
				propertyId: linden.id,
				name: 'Wohnung 1. OG',
				kind: 'apartment',
				floorArea: 76,
				floor: '1. OG',
				rooms: 3
			},
			{ accountId, propertyId: linden.id, name: 'Stellplatz 1', kind: 'parking', floorArea: null },
			{
				accountId,
				propertyId: garten.id,
				name: 'Wohnung EG',
				kind: 'apartment',
				floorArea: 84,
				floor: 'EG',
				rooms: 3
			},
			{
				accountId,
				propertyId: garten.id,
				name: 'Wohnung DG',
				kind: 'apartment',
				floorArea: 55,
				floor: 'DG',
				rooms: 2
			}
		])
		.returning({ id: units.id, name: units.name });
	const unit = (name: string) => unitRows.find((row) => row.name === name)!.id;

	// Tenants.
	const schmidt = await createTenant(
		db,
		accountId,
		tenant('Anna', 'Schmidt', 'anna.schmidt@example.org')
	);
	const yilmaz = await createTenant(
		db,
		accountId,
		tenant('Murat', 'Yılmaz', 'murat.yilmaz@example.org')
	);
	const berger = await createTenant(
		db,
		accountId,
		tenant('Lena', 'Berger', 'lena.berger@example.org')
	);
	const nowak = await createTenant(
		db,
		accountId,
		tenant('Tomasz', 'Nowak', 'tomasz.nowak@example.org')
	);
	const kraus = await createTenant(db, accountId, tenant('Helga', 'Kraus', null));

	// Leases: four running, one ended (the previous tenant of EG rechts).
	const inputs: { key: string; input: LeaseInput }[] = [
		{
			key: 'schmidt',
			input: lease(unit('Wohnung EG links'), [schmidt.id], {
				startDate: '2023-04-01',
				baseRent: 62000,
				operatingCostPrepayment: 13000,
				heatingCostPrepayment: 6000,
				securityDeposit: 186000
			})
		},
		{
			key: 'kraus',
			input: lease(unit('Wohnung EG rechts'), [kraus.id], {
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
			input: lease(unit('Wohnung EG rechts'), [yilmaz.id], {
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
			input: lease(unit('Wohnung 1. OG'), [berger.id], {
				extraUnitIds: [unit('Stellplatz 1')],
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
			input: lease(unit('Wohnung EG'), [nowak.id], {
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
	const leaseIds = new Map<string, string>();
	for (const { key, input } of inputs) {
		const created = await createLease(db, context, input);
		if (!created.ok) throw new Error(`Demo lease ${key}: ${created.reason}`);
		leaseIds.set(key, created.id);
	}

	// Deposits received at the start, and the rent paid month by month until last month (the
	// current month is open on the bank account below). Berger has not paid the two months before:
	// the arrears tile.
	const statements = [];
	for (const { key, input } of inputs) {
		const leaseId = leaseIds.get(key)!;
		statements.push(
			depositEntry(db, context, {
				leaseId,
				date: input.startDate,
				kind: 'received',
				amount: input.securityDeposit,
				note: 'Überweisung bei Vertragsbeginn'
			}).statement
		);
		const total = input.baseRent + input.operatingCostPrepayment + input.heatingCostPrepayment;
		const from =
			monthOf(input.startDate) > firstBookedMonth ? monthOf(input.startDate) : firstBookedMonth;
		const to = input.endDate ? monthOf(input.endDate) : lastMonth;
		if (from > to) continue;
		let months = monthsInRange(from, to);
		if (key === 'berger') months = months.slice(0, -2);
		for (const month of months) {
			statements.push(
				paymentEntry(db, context, {
					leaseId,
					date: addDays(firstOfMonth(month), RENT_DAY),
					amount: total,
					source: 'manual',
					note: `Miete ${month}`
				}).statement
			);
		}
	}
	// Kraus got her deposit back after moving out.
	statements.push(
		depositEntry(db, context, {
			leaseId: leaseIds.get('kraus')!,
			date: '2024-11-15',
			kind: 'returned',
			amount: 156000,
			note: 'Rückzahlung nach Auszug'
		}).statement
	);
	await runBatch(db, statements);

	// A bank account with this month's transactions, none assigned yet: the open transactions tile.
	const bankAccountId = await createBankAccount(db, context, {
		name: 'Mietkonto Sparkasse',
		iban: 'DE02120300000000202051',
		bic: 'BYLADEM1001',
		holder: 'Vermietung Lindenstraße'
	});
	const thisMonth = firstOfMonth(monthOf(date));
	const rows: BankRow[] = [
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
	const fingerprinted = await fingerprintRows(rows);
	await runBatch(
		db,
		chunk(fingerprinted, rowsPerStatement(bankTransactions)).map((group) =>
			db
				.insert(bankTransactions)
				.values(group.map((row) => ({ accountId, bankAccountId, importId: null, ...row })))
		)
	);

	// Last year's cost items for Lindenstraße 12 on the standard categories and keys.
	await ensureDefaults(db, accountId);
	const categories = await listCategories(db, accountId);
	const keys = await listKeys(db, accountId);
	const lastYear = String(Number(date.slice(0, 4)) - 1);
	const items: [string, string, string, number][] = [
		['Grundsteuer', 'Grundsteuerbescheid', 'Finanzamt Berlin', 98400],
		['Wasserversorgung', 'Wasser und Abwasser', 'Berliner Wasserbetriebe', 187250],
		['Straßenreinigung und Müllbeseitigung', 'Müllabfuhr', 'BSR', 96000],
		['Sach- und Haftpflichtversicherung', 'Gebäudeversicherung', 'Allianz', 142300],
		['Hauswart', 'Hausmeisterdienst', 'Hausmeisterservice Krüger', 180000]
	];
	for (const [categoryName, description, supplier, amount] of items) {
		const category = categories.find((row) => row.name === categoryName);
		const keyId = category?.allocationKeyId ?? keys[0]?.id;
		if (!category || !keyId) continue;
		await createCostItem(db, context, {
			propertyId: linden.id,
			categoryId: category.id,
			allocationKeyId: keyId,
			billingCircleId: null,
			description,
			supplier,
			invoiceDate: `${lastYear}-12-15`,
			periodStart: `${lastYear}-01-01`,
			periodEnd: `${lastYear}-12-31`,
			amount,
			allocable: true,
			fuel: null,
			fuelKwh: null,
			co2Kg: null,
			co2Cost: null
		});
	}

	// Two tasks.
	await createTask(db, context, {
		title: 'Rauchmelder prüfen lassen',
		dueDate: addMonths(date, 1),
		propertyId: linden.id,
		leaseId: null,
		note: 'Jährliche Wartung, alle Wohnungen.'
	});
	await createTask(db, context, {
		title: 'Mahnung schreiben',
		dueDate: addDays(date, 7),
		propertyId: null,
		leaseId: leaseIds.get('berger')!,
		note: 'Zwei Monatsmieten offen.'
	});

	await runBatch(db, [
		auditEntry(db, context, 'account', accountId, 'create', 'Demodaten angelegt')
	]);
	return { ok: true, leases: inputs.length };
}
