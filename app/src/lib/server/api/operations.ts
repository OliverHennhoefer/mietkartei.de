import { today } from '../../dates';
import { personName } from '../../format';
import type { ApiCaller } from '../api-keys';
import type { Database } from '../db';
import type { ApiKeyScope } from '../db/schema';
import { listDeadlines } from '../deadlines';
import { depositSummary, listDepositMovements } from '../deposits';
import { getLease, leaseLabel, listLeases, type LeaseSummary } from '../leases';
import { listBalances, listLedger } from '../ledger';
import { listCostItems } from '../operating-costs/cost-items';
import { getProperty, propertyOverview, unitsWithOccupancy } from '../properties';
import { listRentChanges } from '../rents';
import { getStatement, listStatements } from '../statements';
import { listTasks } from '../tasks';
import { getTenant, listTenants } from '../tenants';
import { schema, type InputSchema } from './input';

// The operations of the API, described once: the REST routes under /api/v1 and the tools of the
// MCP server under /mcp both dispatch to this list, so both always offer the same data with the
// same checks. Every operation reads through the functions the pages use, scoped to the account
// of the key's user.

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
			'Lists all properties (Objekte) of the account with their address and the number of units, running leases and vacant units today.',
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
			'Returns one property with its units (Einheiten) and who occupies each unit today.',
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
		description: 'Lists all tenants (Mieter) of the account with their contact details.',
		method: 'GET',
		path: '/tenants',
		scope: 'read',
		readOnly: true,
		input: schema(),
		run: ({ db, caller }) => listTenants(db, caller.user.accountId)
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
