import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { hashPassword, type SessionUser } from './auth';
import type { Database } from './db';
import { accounts, properties, tenants, units, users } from './db/schema';
import { createSqliteDatabase } from './db/sqlite';
import type { Storage } from './storage';
import { createLease, type LeaseInput } from './leases';
import {
	createCostItem,
	ensureDefaults,
	listCategories,
	type CostItemInput
} from './operating-costs';
import type { TenantInput } from './tenants';

// Fixtures for unit tests of server modules: an in-memory database with two accounts (`a` and
// `b`), one owner each, and helpers that create the rows most tests need. Everything a test
// creates in account `b` exists only to prove it does not leak into account `a`.

export const address = { street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' };

export const contextA = { accountId: 'a', userId: 'user-a' };
export const contextB = { accountId: 'b', userId: 'user-b' };

/** A fresh in-memory database with accounts `a` and `b` and one owner each. */
export async function testDatabase(): Promise<Database> {
	const db = createSqliteDatabase(':memory:');
	await db.insert(accounts).values([
		{ id: 'a', name: 'Konto A' },
		{ id: 'b', name: 'Konto B' }
	]);
	await db.insert(users).values([
		{ id: 'user-a', accountId: 'a', email: 'a@example.org', passwordHash: 'x' },
		{ id: 'user-b', accountId: 'b', email: 'b@example.org', passwordHash: 'x' }
	]);
	return db;
}

/**
 * Document storage in memory, for routes that read and write files. A route test hands it to the
 * route by mocking getStorage of '#lib/server/storage/index.ts'.
 */
export function memoryStorage(): Storage & { files: Map<string, Uint8Array> } {
	const files = new Map<string, Uint8Array>();
	const types = new Map<string, string>();
	return {
		files,
		async put(key, body, contentType) {
			files.set(
				key,
				body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
			);
			types.set(key, contentType);
		},
		async get(key) {
			const bytes = files.get(key);
			if (!bytes) return undefined;
			return {
				body: new Response(bytes as Uint8Array<ArrayBuffer>).body!,
				contentType: types.get(key)!,
				size: bytes.length
			};
		},
		async delete(key) {
			files.delete(key);
		},
		async deletePrefix(prefix) {
			for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
		}
	};
}

/** The password tests sign in with; setPassword() gives it to a user. */
export const PASSWORD = 'richtig-geheim-42';

export async function setPassword(db: Database, userId: string, password = PASSWORD) {
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(password) })
		.where(eq(users.id, userId));
}

/** A property with one unit; returns both ids. */
export async function seedUnit(
	db: Database,
	accountId: string,
	overrides: { name?: string; floorArea?: number | null; propertyName?: string } = {}
) {
	const [property] = await db
		.insert(properties)
		.values({ accountId, name: overrides.propertyName ?? 'Haus', ...address })
		.returning({ id: properties.id });
	const [unit] = await db
		.insert(units)
		.values({
			accountId,
			propertyId: property.id,
			name: overrides.name ?? 'EG links',
			kind: 'apartment',
			floorArea: overrides.floorArea === undefined ? 64 : overrides.floorArea
		})
		.returning({ id: units.id });
	return { propertyId: property.id, unitId: unit.id };
}

export function tenantInput(overrides: Partial<TenantInput> = {}): TenantInput {
	return {
		salutation: null,
		firstName: 'Erika',
		lastName: 'Mustermann',
		email: null,
		phone: null,
		street: null,
		postalCode: null,
		city: null,
		notes: null,
		...overrides
	};
}

export async function seedTenant(
	db: Database,
	accountId: string,
	overrides: Partial<TenantInput> = {}
) {
	const [tenant] = await db
		.insert(tenants)
		.values({ accountId, ...tenantInput(overrides) })
		.returning({ id: tenants.id });
	return tenant.id;
}

/** A plain residential lease from 2025-01-01 at 600 € + 150 € + 50 €. */
export function leaseInput(unitId: string, overrides: Partial<LeaseInput> = {}): LeaseInput {
	return {
		unitId,
		extraUnitIds: [],
		tenantIds: [],
		startDate: '2025-01-01',
		endDate: null,
		kind: 'residential',
		rentModel: 'fixed',
		operatingCostModel: 'prepayment',
		heatingCostModel: 'prepayment',
		baseRent: 60000,
		operatingCostPrepayment: 15000,
		heatingCostPrepayment: 5000,
		securityDeposit: 180000,
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

/** Creates a lease of the unit with leaseInput() and the overrides; returns its id. */
export async function seedLease(
	db: Database,
	accountId: string,
	unitId: string,
	overrides: Partial<LeaseInput> = {}
): Promise<string> {
	const result = await createLease(db, { accountId, userId: null }, leaseInput(unitId, overrides));
	if (!result.ok) throw new Error(`seedLease failed: ${result.reason}`);
	return result.id;
}

// Route tests call a load function, action or request handler with routeEvent() and look at what
// came out with outcome(): data, a fail(), a redirect() or an error(), the way SvelteKit tells
// them apart.

/** The owner of account `a`, signed in. */
export const ownerA: SessionUser = {
	id: 'user-a',
	email: 'a@example.org',
	accountId: 'a',
	name: null,
	role: 'owner'
};

/** A manager (Mitverwalter) of account `a`; the user row exists only when a test inserts it. */
export const managerA: SessionUser = { ...ownerA, id: 'manager-a', role: 'manager' };

export type RouteEventOptions = {
	/** The signed-in user; null for a visitor. Defaults to ownerA. */
	user?: SessionUser | null;
	params?: Record<string, string>;
	/** Path and query, e.g. '/objekte?neu=1'. */
	url?: string;
	/** Posts these fields as a form; an array posts the field once per value, e.g. several files. */
	form?: Record<string, string | File | (string | File)[]>;
	/** The cookie jar; the test keeps it to look at what the route set. */
	cookies?: Map<string, string>;
	/** What the layouts above the page loaded. */
	parent?: Record<string, unknown>;
	clientAddress?: string;
};

/**
 * A request event for a route of the app. Typed `never`, so it fits any route's event type;
 * the route only uses what is here.
 */
export function routeEvent(db: Database, options: RouteEventOptions = {}): never {
	const url = new URL(options.url ?? '/', 'http://localhost');
	let body: FormData | undefined;
	if (options.form) {
		body = new FormData();
		for (const [name, value] of Object.entries(options.form)) {
			for (const item of Array.isArray(value) ? value : [value]) body.append(name, item);
		}
	}
	const jar = options.cookies ?? new Map<string, string>();
	return {
		locals: { db, user: options.user === undefined ? ownerA : (options.user ?? undefined) },
		params: options.params ?? {},
		url,
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: {
			get: (name: string) => jar.get(name),
			getAll: () => [...jar].map(([name, value]) => ({ name, value })),
			set: (name: string, value: string) => void jar.set(name, value),
			delete: (name: string) => void jar.delete(name)
		},
		parent: async () => options.parent ?? {},
		getClientAddress: () => options.clientAddress ?? '127.0.0.1',
		setHeaders: () => {},
		route: { id: null }
	} as never;
}

export type Outcome =
	| { data: unknown }
	| { fail: number; data: Record<string, unknown> }
	| { redirect: string }
	| { error: number; message: string };

/** Runs a load function, action or handler and returns how it ended. */
export async function outcome(run: () => unknown): Promise<Outcome> {
	try {
		const data = await run();
		if (isActionFailure(data)) {
			return { fail: data.status, data: data.data as unknown as Record<string, unknown> };
		}
		return { data };
	} catch (thrown) {
		if (isRedirect(thrown)) return { redirect: thrown.location };
		if (isHttpError(thrown)) return { error: thrown.status, message: thrown.body.message };
		throw thrown;
	}
}

/**
 * A cost item of 600 € for 2025 in the first standard category with a default key ("Grundsteuer"
 * unless overridden); seeds the standard categories and keys first. Returns its id.
 */
export async function seedCostItem(
	db: Database,
	accountId: string,
	propertyId: string,
	overrides: Partial<CostItemInput> = {}
): Promise<string> {
	await ensureDefaults(db, accountId);
	const [category] = (await listCategories(db, accountId)).filter((row) => row.allocationKeyId);
	const result = await createCostItem(
		db,
		{ accountId, userId: null },
		{
			propertyId,
			categoryId: category.id,
			allocationKeyId: category.allocationKeyId!,
			billingCircleId: null,
			description: 'Grundsteuer',
			supplier: null,
			invoiceDate: null,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 60000,
			allocable: true,
			fuel: null,
			fuelKwh: null,
			co2Kg: null,
			co2Cost: null,
			...overrides
		}
	);
	if (!result.ok) throw new Error(`seedCostItem failed: ${result.reason}`);
	return result.id;
}
