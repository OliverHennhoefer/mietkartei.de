import type { APIRequestContext } from '@playwright/test';
import type { SeedLeaseOverrides, SeedLeaseResult } from '../src/lib/server/e2e-seed';

/**
 * Seed what you do not own, drive only your own pages. A feature's end-to-end test creates its
 * prerequisites through these helpers (a lease with property, unit and tenant; rows of tables
 * other features define) instead of clicking through other features' pages, so
 * it keeps working when those pages change. Everything lands in the owner's account; seeded
 * names carry a random suffix, so repeated calls do not collide. Pass `page.request`.
 */

async function post(request: APIRequestContext, body: Record<string, unknown>): Promise<unknown> {
	const response = await request.post('/__e2e/seed', { data: body });
	if (!response.ok()) {
		throw new Error(
			`Seed ${String(body.op)} failed with ${response.status()}: ${await response.text()}`
		);
	}
	return response.json();
}

/**
 * A property ("Testhaus …" in Berlin) with one apartment ("Wohnung …", 64 m²), a tenant
 * (Erika Muster-…) and a residential lease from 2025-01-01 at 600 € + 150 € + 50 €, deposit
 * 1.800 €, two persons. Overrides are partial rows of each table and a partial LeaseInput.
 */
export async function seedLease(
	request: APIRequestContext,
	overrides: SeedLeaseOverrides = {}
): Promise<SeedLeaseResult> {
	return (await post(request, { op: 'lease', ...overrides })) as SeedLeaseResult;
}

/**
 * The same lease as seedLease, but in a second account ("Fremdes Konto") that no e2e user
 * belongs to. Its ids are real, so a page that forgot the account filter would show them; every
 * id route must answer them with 404.
 */
export async function seedForeignLease(request: APIRequestContext): Promise<SeedLeaseResult> {
	return (await post(request, { op: 'foreignLease' })) as SeedLeaseResult;
}

/**
 * Inserts raw rows into a schema table, named by its export (`leaseTenants`) or SQL name
 * (`lease_tenants`). The account is forced to the owner's, missing ids are generated. Returns
 * the ids in row order (none for link tables without an id column).
 */
export async function seedRows(
	request: APIRequestContext,
	table: string,
	rows: Record<string, unknown>[]
): Promise<{ ids: string[] }> {
	return (await post(request, { op: 'rows', table, rows })) as { ids: string[] };
}
