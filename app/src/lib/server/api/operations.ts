import { today } from '../../dates';
import { loadAnalysis } from '../analysis';
import { applyCategoryDefaults } from '../../domain/operating-costs';
import { personName } from '../../format';
import { repeatOptions } from '../../task-templates';
import type { ApiCaller } from '../api-keys';
import type { AuditContext } from '../audit';
import type { Database } from '../db';
import { taskCategories, type ApiKeyScope, type TaskCategory } from '../db/schema';
import { listDeadlines } from '../deadlines';
import { depositSummary, listDepositMovements } from '../deposits';
import { listExpenses } from '../expenses';
import { getLease, leaseLabel, listLeases, type LeaseSummary } from '../leases';
import { createPayment, listBalances, listLedger } from '../ledger';
import {
	createCostItem,
	ensureDefaults,
	getCategory,
	getCostItem,
	listCategories,
	listCostItems,
	listKeys
} from '../operating-costs';
import { getProperty, propertyOverview, unitsWithOccupancy } from '../properties';
import { reminderState } from '../reminders';
import { listRentChanges } from '../rents';
import { getStatement, listStatements } from '../statements';
import { createTask, getTask, listTasks, setDone } from '../tasks';
import { getTenant, listTenants } from '../tenants';
import { schema, type InputSchema } from './input';

// The operations of the API, described once: the REST routes under /api/v1 and the tools of the
// MCP server under /mcp both dispatch to this list, so both always offer the same data with the
// same checks. Every operation reads and writes through the functions the pages use, scoped to the
// account of the key's user; writes are audited under that user like a change on the page. Only a
// few writes are offered, each one adding something and none deleting: a payment, a task (and
// ticking it off), a cost item.

export type ApiContext = { db: Database; caller: ApiCaller };

export type Operation = {
	/** The MCP tool name. */
	name: string;
	/** For the tool list and the REST documentation; written for the model that picks a tool. */
	description: string;
	method: 'GET' | 'POST';
	/** The REST path below /api/v1; `{id}` segments are filled from the input field `id`. */
	path: string;
	/** The scope a key needs: write keys may also read. */
	scope: ApiKeyScope;
	/** Changes nothing; MCP clients may call it without asking. */
	readOnly: boolean;
	input: InputSchema;
	run(context: ApiContext, input: Record<string, string | number | boolean>): Promise<unknown>;
};

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

function notFound(what: string): never {
	throw new ApiError(404, 'not_found', `${what} not found.`);
}

const AMOUNTS = 'Amounts are integer euro cents; dates are YYYY-MM-DD.';

const id = (what: string) => ({ type: 'string' as const, description: `The id of the ${what}.` });

/** The largest amount a write accepts, as the forms do: 100 million euros, in cents. */
const MAX_AMOUNT = 100_000_000_00;

/** Writes are audited as changes of the key's user. */
function auditContextOf(caller: ApiCaller): AuditContext {
	return { accountId: caller.user.accountId, userId: caller.user.id };
}

function invalid(message: string): never {
	throw new ApiError(400, 'invalid_input', message);
}

/** A lease in lists: who rents what, from when, for how much. */
function leaseEntry(lease: LeaseSummary) {
	return {
		id: lease.id,
		label: leaseLabel(lease),
		propertyId: lease.property.id,
		unitId: lease.unitId,
		extraUnitIds: lease.extraUnits.map((unit) => unit.id),
		tenants: lease.tenants.map((tenant) => ({ id: tenant.id, name: personName(tenant) })),
		kind: lease.kind,
		startDate: lease.startDate,
		endDate: lease.endDate,
		active: lease.active,
		upcoming: lease.upcoming,
		currentRent: lease.currentRent,
		securityDeposit: lease.securityDeposit
	};
}

export const operations: Operation[] = [
	{
		name: 'list_properties',
		description:
			'Lists all properties (Objekte) of the account with their address and the number of units, running leases and vacant units today. archivedAt is set for archived (e.g. sold) properties.',
		method: 'GET',
		path: '/properties',
		scope: 'read',
		readOnly: true,
		input: schema(),
		run: ({ db, caller }) => propertyOverview(db, caller.user.accountId, today())
	},
	{
		name: 'get_property',
		description:
			'Returns one property with its units (Einheiten) and who occupies each unit today. kind is "building" for an own building or "condominium" for an Eigentumswohnung in a WEG, which then has associationManager (Verwalter), ownershipShare (its MEA) and ownershipShareTotal (MEA of the WEG).',
		method: 'GET',
		path: '/properties/{id}',
		scope: 'read',
		readOnly: true,
		input: schema({ id: id('property') }, ['id']),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const property = await getProperty(db, accountId, String(input.id));
			if (!property) notFound('Property');
			const units = await unitsWithOccupancy(db, accountId, property.id, today());
			return { ...property, units };
		}
	},
	{
		name: 'list_tenants',
		description:
			'Lists all tenants (Mieter) of the account with their contact details. archivedAt is set for archived tenants (e.g. moved out).',
		method: 'GET',
		path: '/tenants',
		scope: 'read',
		readOnly: true,
		input: schema(),
		run: ({ db, caller }) => listTenants(db, caller.user.accountId, { archived: true })
	},
	{
		name: 'get_tenant',
		description: 'Returns one tenant with their contact details and all their leases.',
		method: 'GET',
		path: '/tenants/{id}',
		scope: 'read',
		readOnly: true,
		input: schema({ id: id('tenant') }, ['id']),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const tenant = await getTenant(db, accountId, String(input.id));
			if (!tenant) notFound('Tenant');
			const leases = await listLeases(db, accountId, { tenantId: tenant.id });
			return { ...tenant, leases: leases.map(leaseEntry) };
		}
	},
	{
		name: 'list_leases',
		description: `Lists the leases (Mietverträge), newest start first, with unit, tenants, term and current rent (Kaltmiete plus prepayments). ${AMOUNTS}`,
		method: 'GET',
		path: '/leases',
		scope: 'read',
		readOnly: true,
		input: schema({
			unitId: { type: 'string', description: 'Only leases of this unit.' },
			tenantId: { type: 'string', description: 'Only leases of this tenant.' },
			status: {
				type: 'string',
				enum: ['active', 'upcoming', 'ended', 'all'],
				description: 'Running today, starting later, ended, or all (default).'
			}
		}),
		async run({ db, caller }, input) {
			const leases = await listLeases(db, caller.user.accountId, {
				unitId: input.unitId as string | undefined,
				tenantId: input.tenantId as string | undefined
			});
			const status = input.status ?? 'all';
			return leases
				.filter((lease) => {
					if (status === 'active') return lease.active;
					if (status === 'upcoming') return lease.upcoming;
					if (status === 'ended') return !lease.active && !lease.upcoming;
					return true;
				})
				.map(leaseEntry);
		}
	},
	{
		name: 'get_lease',
		description: `Returns one lease in full: unit, property, tenants, rent model, the history of rent changes and the security deposit (Kaution) with what was received and is held. ${AMOUNTS}`,
		method: 'GET',
		path: '/leases/{id}',
		scope: 'read',
		readOnly: true,
		input: schema({ id: id('lease') }, ['id']),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const lease = await getLease(db, accountId, String(input.id));
			if (!lease) notFound('Lease');
			const [rentChanges, movements] = await Promise.all([
				listRentChanges(db, accountId, lease.id),
				listDepositMovements(db, accountId, lease.id)
			]);
			return {
				...lease,
				label: leaseLabel(lease),
				rentChanges,
				deposit: { ...depositSummary(movements, lease.securityDeposit), movements }
			};
		}
	},
	{
		name: 'get_rent_ledger',
		description: `Returns the rent account (Mietkonto) of one lease: charges and payments in date order with a running balance (positive = owed by the tenant, negative = credit). ${AMOUNTS}`,
		method: 'GET',
		path: '/leases/{id}/ledger',
		scope: 'read',
		readOnly: true,
		input: schema(
			{
				id: id('lease'),
				from: { type: 'string', format: 'date', description: 'Leave out lines before this day.' },
				to: { type: 'string', format: 'date', description: 'Leave out lines after this day.' }
			},
			['id']
		),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const lease = await getLease(db, accountId, String(input.id));
			if (!lease) notFound('Lease');
			return listLedger(db, accountId, lease.id, {
				from: input.from as string | undefined,
				to: input.to as string | undefined
			});
		}
	},
	{
		name: 'list_balances',
		description: `Lists the balance of every lease, largest first: what was charged and paid, the overdue amount (Rückstand) today, since which month it is open and the last payment. Use it to find tenants in arrears. ${AMOUNTS}`,
		method: 'GET',
		path: '/balances',
		scope: 'read',
		readOnly: true,
		input: schema(),
		async run({ db, caller }) {
			const { accountId } = caller.user;
			const [balances, leases] = await Promise.all([
				listBalances(db, accountId),
				listLeases(db, accountId)
			]);
			const leaseById = new Map(leases.map((lease) => [lease.id, leaseEntry(lease)]));
			return balances.map((balance) => {
				const lease = leaseById.get(balance.leaseId);
				return { ...balance, label: lease?.label, tenants: lease?.tenants ?? [] };
			});
		}
	},
	{
		name: 'get_reminder_state',
		description: `Returns the dunning state (Mahnwesen) of one lease today: the open items oldest first, the overdue total, the reminders and dunning letters (Zahlungserinnerung, Mahnungen) already sent, the level the next letter should have, and the default interest (Verzugszinsen, § 288 BGB) on the open items with the Basiszinssatz it uses. Interest rates are in basis points (152 = 1.52 %). Letters are written in the app. ${AMOUNTS}`,
		method: 'GET',
		path: '/leases/{id}/reminders',
		scope: 'read',
		readOnly: true,
		input: schema({ id: id('lease') }, ['id']),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const lease = await getLease(db, accountId, String(input.id));
			if (!lease) notFound('Lease');
			return reminderState(db, accountId, lease.id);
		}
	},
	{
		name: 'list_expenses',
		description: `Lists the expenses (Ausgaben) the landlord paid out, newest first, e.g. repairs, loan interest or management fees, each for a unit, a property or the whole portfolio. Unlike cost items they are not passed on to tenants. ${AMOUNTS}`,
		method: 'GET',
		path: '/expenses',
		scope: 'read',
		readOnly: true,
		input: schema({
			from: { type: 'string', format: 'date', description: 'Earliest day to include.' },
			to: { type: 'string', format: 'date', description: 'Latest day to include.' }
		}),
		run: ({ db, caller }, input) =>
			listExpenses(db, caller.user.accountId, {
				from: input.from as string | undefined,
				to: input.to as string | undefined
			})
	},
	{
		name: 'get_analysis',
		description: `Returns the analysis (Auswertung) of one calendar year or of all years: rent charged and received, expenses, net income, collection and vacancy rate, rent per m², a monthly (or yearly) series, expenses by category and the figures per property and unit. Use it for income questions, e.g. for the tax return (Anlage V). ${AMOUNTS}`,
		method: 'GET',
		path: '/analysis',
		scope: 'read',
		readOnly: true,
		input: schema({
			year: {
				type: 'integer',
				minimum: 1900,
				maximum: 2100,
				description: 'The calendar year; defaults to the current one.'
			},
			allYears: { type: 'boolean', description: 'All years with data instead of one year.' },
			propertyId: { type: 'string', description: 'Only this property.' }
		}),
		run: ({ db, caller }, input) =>
			loadAnalysis(db, caller.user.accountId, {
				period: input.allYears
					? 'all'
					: ((input.year as number | undefined) ?? Number(today().slice(0, 4))),
				propertyId: (input.propertyId as string | undefined) ?? null
			})
	},
	{
		name: 'list_cost_items',
		description: `Lists the cost items (Belege) of the operating costs, newest invoice first, with category, allocation key and period. ${AMOUNTS}`,
		method: 'GET',
		path: '/cost-items',
		scope: 'read',
		readOnly: true,
		input: schema({
			propertyId: { type: 'string', description: 'Only cost items of this property.' },
			year: {
				type: 'integer',
				minimum: 1900,
				maximum: 2100,
				description: 'Only cost items whose period overlaps this calendar year.'
			}
		}),
		run: ({ db, caller }, input) =>
			listCostItems(db, caller.user.accountId, {
				propertyId: input.propertyId as string | undefined,
				year: input.year as number | undefined
			})
	},
	{
		name: 'list_statements',
		description: `Lists the operating cost statements (Betriebskostenabrechnungen) grouped by property, with status, totals and the sums of Nachzahlungen and Guthaben. ${AMOUNTS}`,
		method: 'GET',
		path: '/statements',
		scope: 'read',
		readOnly: true,
		input: schema(),
		run: ({ db, caller }) => listStatements(db, caller.user.accountId)
	},
	{
		name: 'get_statement',
		description: `Returns one operating cost statement with its full result per lease and cost item, and the warnings that block its approval. ${AMOUNTS}`,
		method: 'GET',
		path: '/statements/{id}',
		scope: 'read',
		readOnly: true,
		input: schema({ id: id('statement') }, ['id']),
		async run({ db, caller }, input) {
			const statement = await getStatement(db, caller.user.accountId, String(input.id));
			if (!statement) notFound('Statement');
			return statement;
		}
	},
	{
		name: 'list_deadlines',
		description:
			'Lists the deadlines that follow from the data, by date: statements due, rent increases possible, deposit instalments, lease ends, meter readings. Overdue ones are always included.',
		method: 'GET',
		path: '/deadlines',
		scope: 'read',
		readOnly: true,
		input: schema({
			from: { type: 'string', format: 'date', description: 'Earliest day to include.' },
			to: { type: 'string', format: 'date', description: 'Latest day to include.' }
		}),
		async run({ db, caller }, input) {
			const deadlines = await listDeadlines(db, caller.user.accountId, {
				from: input.from as string | undefined,
				to: input.to as string | undefined
			});
			// The links point into the app; outside of it they mean nothing.
			return deadlines.map((deadline) => ({ ...deadline, href: undefined }));
		}
	},
	{
		name: 'list_tasks',
		description:
			'Lists the tasks (Aufgaben) the landlord wrote down: open ones by due date, done ones by completion.',
		method: 'GET',
		path: '/tasks',
		scope: 'read',
		readOnly: true,
		input: schema({
			status: {
				type: 'string',
				enum: ['open', 'done', 'all'],
				description: 'Open tasks (default), done tasks, or both.'
			}
		}),
		async run({ db, caller }, input) {
			const { open, done } = await listTasks(db, caller.user.accountId);
			const status = input.status ?? 'open';
			if (status === 'open') return open;
			if (status === 'done') return done;
			return [...open, ...done];
		}
	},
	{
		name: 'list_cost_categories',
		description:
			'Lists the cost categories (Kostenarten) with their § 2 BetrKV number, whether they may be passed on to tenants, and their default allocation key (Umlageschlüssel). Use their ids for create_cost_item.',
		method: 'GET',
		path: '/cost-categories',
		scope: 'read',
		readOnly: true,
		input: schema(),
		async run({ db, caller }) {
			const { accountId } = caller.user;
			await ensureDefaults(db, accountId);
			const [categories, keys] = await Promise.all([
				listCategories(db, accountId),
				listKeys(db, accountId)
			]);
			const keyName = new Map(keys.map((key) => [key.id, key.name]));
			return categories.map((category) => ({
				...category,
				allocationKeyName: category.allocationKeyId
					? (keyName.get(category.allocationKeyId) ?? null)
					: null
			}));
		}
	},
	{
		name: 'list_allocation_keys',
		description:
			'Lists the allocation keys (Umlageschlüssel) of the operating costs, e.g. by floor area or by persons.',
		method: 'GET',
		path: '/allocation-keys',
		scope: 'read',
		readOnly: true,
		input: schema(),
		async run({ db, caller }) {
			await ensureDefaults(db, caller.user.accountId);
			return listKeys(db, caller.user.accountId);
		}
	},
	{
		name: 'record_payment',
		description: `Books a payment of the tenant on the rent account (Mietkonto) of a lease, e.g. a rent transfer. A negative amount is a refund to the tenant. Check get_rent_ledger first, so a payment is not booked twice. ${AMOUNTS}`,
		method: 'POST',
		path: '/leases/{id}/payments',
		scope: 'write',
		readOnly: false,
		input: schema(
			{
				id: id('lease'),
				date: { type: 'string', format: 'date', description: 'The day the money came in.' },
				amount: {
					type: 'integer',
					minimum: -MAX_AMOUNT,
					maximum: MAX_AMOUNT,
					description: 'In cents; positive = received, negative = refunded.'
				},
				note: { type: 'string', maxLength: 200, description: 'Shown in the rent account.' }
			},
			['id', 'date', 'amount']
		),
		async run({ db, caller }, input) {
			if (input.amount === 0) invalid('"amount" must not be 0.');
			const paymentId = await createPayment(db, auditContextOf(caller), {
				leaseId: String(input.id),
				date: String(input.date),
				amount: Number(input.amount),
				source: 'manual',
				note: (input.note as string | undefined) || null
			});
			if (!paymentId) notFound('Lease');
			return { id: paymentId, leaseId: input.id, date: input.date, amount: input.amount };
		}
	},
	{
		name: 'create_task',
		description:
			'Writes down a task (Aufgabe) for the landlord, optionally due on a date, repeating, and linked to a property or a lease.',
		method: 'POST',
		path: '/tasks',
		scope: 'write',
		readOnly: false,
		input: schema(
			{
				title: { type: 'string', maxLength: 200, description: 'What to do, in German.' },
				category: {
					type: 'string',
					enum: taskCategories,
					description: 'maintenance, inspection, insurance or other (default).'
				},
				dueDate: { type: 'string', format: 'date', description: 'When it is due.' },
				repeatMonths: {
					type: 'integer',
					minimum: 1,
					maximum: 120,
					description: `Repeat every this many months once done: ${repeatOptions.map((option) => option.months).join(', ')}. Needs dueDate.`
				},
				propertyId: { type: 'string', description: 'The property it concerns.' },
				leaseId: { type: 'string', description: 'The lease it concerns.' },
				note: { type: 'string', maxLength: 2000, description: 'Details.' }
			},
			['title']
		),
		async run({ db, caller }, input) {
			const title = String(input.title);
			const repeatMonths = (input.repeatMonths as number | undefined) ?? null;
			if (repeatMonths && !repeatOptions.some((option) => option.months === repeatMonths)) {
				invalid(
					`"repeatMonths" must be one of ${repeatOptions.map((option) => option.months).join(', ')}.`
				);
			}
			if (repeatMonths && !input.dueDate) invalid('A repeating task needs "dueDate".');
			if (input.propertyId && input.leaseId) invalid('Link either "propertyId" or "leaseId".');
			const result = await createTask(db, auditContextOf(caller), {
				title,
				category: (input.category as TaskCategory | undefined) ?? 'other',
				dueDate: (input.dueDate as string | undefined) ?? null,
				repeatMonths,
				propertyId: (input.propertyId as string | undefined) ?? null,
				leaseId: (input.leaseId as string | undefined) ?? null,
				note: (input.note as string | undefined) || null
			});
			if (!result.ok) {
				notFound(result.reason === 'unknown-lease' ? 'Lease' : 'Property');
			}
			return getTask(db, caller.user.accountId, result.id);
		}
	},
	{
		name: 'complete_task',
		description: 'Ticks off an open task. A repeating task gets an open copy due at its next date.',
		method: 'POST',
		path: '/tasks/{id}/done',
		scope: 'write',
		readOnly: false,
		input: schema({ id: id('task') }, ['id']),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const task = await getTask(db, accountId, String(input.id));
			if (!task) notFound('Task');
			if (task.done) throw new ApiError(409, 'already_done', 'The task is already done.');
			await setDone(db, auditContextOf(caller), task.id, true);
			return getTask(db, accountId, task.id);
		}
	},
	{
		name: 'create_cost_item',
		description: `Records a cost item (Beleg) of the operating costs, e.g. an invoice for property tax or insurance, for the period it covers. Without allocationKeyId the category's default key applies. Heating costs with CO₂ data are entered in the app. For an Eigentumswohnung (property kind "condominium"), a cost from the Hausgeldabrechnung takes amount = the unit's share and associationTotal, associationKeyTotal and associationKeyShare from the Verwalter (e.g. 420000 cents by MEA, 85 of 1000), so the tenant's statement shows how the share came about. ${AMOUNTS}`,
		method: 'POST',
		path: '/cost-items',
		scope: 'write',
		readOnly: false,
		input: schema(
			{
				propertyId: id('property'),
				categoryId: { type: 'string', description: 'The id of the cost category (Kostenart).' },
				allocationKeyId: { type: 'string', description: 'Overrides the category’s key.' },
				description: { type: 'string', maxLength: 200, description: 'E.g. "Grundsteuer 2026".' },
				supplier: { type: 'string', maxLength: 200, description: 'Who issued the invoice.' },
				invoiceDate: { type: 'string', format: 'date', description: 'The invoice’s date.' },
				periodStart: { type: 'string', format: 'date', description: 'First day it covers.' },
				periodEnd: { type: 'string', format: 'date', description: 'Last day it covers.' },
				amount: {
					type: 'integer',
					minimum: -MAX_AMOUNT,
					maximum: MAX_AMOUNT,
					description: 'In cents, gross; negative for a credit note.'
				},
				allocable: {
					type: 'boolean',
					description: 'May be passed on to tenants; defaults to the category’s setting.'
				},
				associationTotal: {
					type: 'integer',
					minimum: -MAX_AMOUNT,
					maximum: MAX_AMOUNT,
					description:
						'WEG only: the cost of the whole WEG in cents, from the Hausgeldabrechnung. Needs associationKeyTotal and associationKeyShare.'
				},
				associationKey: {
					type: 'string',
					maxLength: 50,
					description: 'WEG only: the Verwalter’s key, e.g. "MEA" (the default) or "Wohnfläche".'
				},
				associationKeyTotal: {
					type: 'number',
					minimum: 0,
					maximum: 1_000_000_000,
					description: 'WEG only: the key’s total in the WEG, e.g. 1000 MEA.'
				},
				associationKeyShare: {
					type: 'number',
					minimum: 0,
					maximum: 1_000_000_000,
					description: 'WEG only: the unit’s share of the key, e.g. 85 MEA.'
				}
			},
			['propertyId', 'categoryId', 'description', 'periodStart', 'periodEnd', 'amount']
		),
		async run({ db, caller }, input) {
			const { accountId } = caller.user;
			const description = String(input.description);
			if (!description) invalid('"description" must not be empty.');
			if (String(input.periodEnd) < String(input.periodStart)) {
				invalid('"periodEnd" lies before "periodStart".');
			}
			const associationGiven = [
				input.associationTotal,
				input.associationKeyTotal,
				input.associationKeyShare
			].filter((value) => value !== undefined).length;
			if (associationGiven !== 0 && associationGiven !== 3) {
				invalid(
					'Pass "associationTotal", "associationKeyTotal" and "associationKeyShare" together.'
				);
			}
			if (associationGiven === 3) {
				if (Number(input.associationKeyTotal) <= 0)
					invalid('"associationKeyTotal" must be above 0.');
				if (Number(input.associationKeyShare) > Number(input.associationKeyTotal)) {
					invalid('"associationKeyShare" must not exceed "associationKeyTotal".');
				}
			}
			await ensureDefaults(db, accountId);
			const category = await getCategory(db, accountId, String(input.categoryId));
			if (!category) notFound('Cost category');
			const resolved = applyCategoryDefaults(
				{
					allocationKeyId: (input.allocationKeyId as string | undefined) ?? null,
					billingCircleId: null,
					circleFromCategory: true,
					fuel: null,
					fuelKwh: null,
					co2Kg: null
				},
				category
			);
			if (!resolved) {
				invalid('The category has no default allocation key; pass "allocationKeyId".');
			}
			const created = await createCostItem(db, auditContextOf(caller), {
				propertyId: String(input.propertyId),
				categoryId: category.id,
				allocationKeyId: resolved.allocationKeyId,
				billingCircleId: resolved.billingCircleId,
				description,
				supplier: (input.supplier as string | undefined) || null,
				invoiceDate: (input.invoiceDate as string | undefined) ?? null,
				periodStart: String(input.periodStart),
				periodEnd: String(input.periodEnd),
				amount: Number(input.amount),
				allocable: (input.allocable as boolean | undefined) ?? category.allocable,
				fuel: null,
				fuelKwh: null,
				co2Kg: null,
				co2Cost: null,
				associationTotal: associationGiven ? Number(input.associationTotal) : null,
				associationKey: associationGiven
					? (input.associationKey as string | undefined) || 'MEA'
					: null,
				associationKeyTotal: associationGiven ? Number(input.associationKeyTotal) : null,
				associationKeyShare: associationGiven ? Number(input.associationKeyShare) : null
			});
			if (!created.ok) {
				const what = {
					missing: 'Cost item',
					'unknown-property': 'Property',
					'unknown-category': 'Cost category',
					'unknown-key': 'Allocation key',
					'unknown-circle': 'Billing circle'
				}[created.reason];
				notFound(what);
			}
			return getCostItem(db, accountId, created.id);
		}
	}
];

export const operationByName = new Map(operations.map((operation) => [operation.name, operation]));

/** May the caller run the operation? A write key may do everything a read key may. */
export function permits(caller: ApiCaller, operation: Operation): boolean {
	return operation.scope === 'read' || caller.scope === 'write';
}

/**
 * JSON for a result: dates as ISO strings, without undefined fields and without the account id,
 * which the caller knows and which says nothing about the data.
 */
export function toJson(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(toJson);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key, inner]) => key !== 'accountId' && inner !== undefined)
				.map(([key, inner]) => [key, toJson(inner)])
		);
	}
	return value;
}
