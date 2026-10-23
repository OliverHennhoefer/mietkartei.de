import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiKey } from '#lib/server/api-keys.ts';
import type { Database } from '#lib/server/db/index.ts';
import { contextA, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { GET, POST } from './+server';

const env = vi.hoisted(() => ({
	BILLING_REQUIRED: false,
	STRIPE_SECRET_KEY: '',
	STRIPE_PRICE_ID: ''
}));
vi.mock('$app/env/private', () => env);

let db: Database;
let key: string;

beforeEach(async () => {
	db = await testDatabase();
	const created = await createApiKey(db, contextA, {
		name: 'Test',
		scope: 'read',
		lifetimeDays: 30
	});
	if (!created.ok) throw new Error(created.reason);
	key = created.key;
});

/** Calls the API at the path below /api/v1, with the key unless told otherwise. */
async function call(
	path: string,
	options: { method?: 'GET' | 'POST'; key?: string | null; body?: string; address?: string } = {}
) {
	const url = new URL(`/api/v1${path}`, 'http://localhost');
	const headers = new Headers();
	const token = options.key === undefined ? key : options.key;
	if (token) headers.set('authorization', `Bearer ${token}`);
	const method = options.method ?? 'GET';
	const request = new Request(url, { method, headers, body: options.body });
	const event = {
		request,
		url,
		params: { path: url.pathname.slice('/api/v1/'.length) },
		locals: { db, user: undefined },
		getClientAddress: () => options.address ?? '10.0.0.1'
	} as never;
	const response = await (method === 'GET' ? GET : POST)(event);
	return { status: response.status, headers: response.headers, body: await response.json() };
}

describe('/api/v1', () => {
	it('refuses calls without a valid key', async () => {
		const missing = await call('/leases', { key: null });
		expect(missing.status).toBe(401);
		expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="mietkartei"');
		expect(missing.body.error.code).toBe('unauthorized');
		expect((await call('/leases', { key: 'mk_wrong' })).status).toBe(401);
	});

	it('limits calls with a wrong key per address', async () => {
		let last;
		for (let i = 0; i < 121; i++)
			last = await call('/leases', { key: 'mk_x', address: '10.9.9.9' });
		expect(last?.status).toBe(429);
		expect(last?.headers.get('retry-after')).toBe('60');
	});

	it('lists the operations', async () => {
		const { status, body } = await call('');
		expect(status).toBe(200);
		expect(body.operations).toContainEqual(
			expect.objectContaining({
				method: 'GET',
				path: '/api/v1/leases/{id}/ledger',
				tool: 'get_rent_ledger'
			})
		);
	});

	it('answers an operation with the data of the key’s account', async () => {
		const { unitId, propertyId } = await seedUnit(db, 'a');
		const leaseId = await seedLease(db, 'a', unitId);
		const list = await call('/leases?status=active');
		expect(list.status).toBe(200);
		expect(list.body.data).toMatchObject([{ id: leaseId, propertyId }]);
		const ledger = await call(`/leases/${leaseId}/ledger?from=2025-01-01&to=2025-01-31`);
		expect(ledger.status).toBe(200);
		expect(ledger.body.data.lines).toHaveLength(1);
	});

	it('answers 404 for rows of another account and unknown paths', async () => {
		const other = await seedUnit(db, 'b');
		expect((await call(`/properties/${other.propertyId}`)).body).toEqual({
			error: { code: 'not_found', message: 'Property not found.' }
		});
		expect((await call('/nothing')).status).toBe(404);
	});

	it('answers 400 for invalid parameters and 405 for the wrong method', async () => {
		const invalid = await call('/cost-items?year=zwanzig');
		expect(invalid.status).toBe(400);
		expect(invalid.body.error.message).toBe('"year" must be an integer.');
		expect((await call('/leases?sort=name')).status).toBe(400);
		expect((await call('/leases', { method: 'POST', body: '{}' })).status).toBe(405);
	});
});
