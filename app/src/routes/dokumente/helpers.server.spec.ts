import { describe, expect, it } from 'vitest';
import type { documents } from '#lib/server/db/schema.ts';
import { createLease } from '#lib/server/leases.ts';
import {
	contextA,
	contextB,
	leaseInput,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { documentRow, loadDocumentLinkOptions } from './helpers.server';

describe('loadDocumentLinkOptions', () => {
	it('lists properties, units, leases with tenants and tenants as labels', async () => {
		const db = await testDatabase();
		const { propertyId, unitId } = await seedUnit(db, 'a', {
			propertyName: 'Lindenstraße 4',
			name: 'EG links'
		});
		const tenantId = await seedTenant(db, 'a', { firstName: 'Erika', lastName: 'Mustermann' });
		const lease = await createLease(db, contextA, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!lease.ok) throw new Error('setup failed');

		expect(await loadDocumentLinkOptions(db, 'a')).toEqual({
			properties: [{ id: propertyId, label: 'Lindenstraße 4' }],
			units: [{ id: unitId, label: 'EG links · Lindenstraße 4', propertyId }],
			leases: [{ id: lease.id, label: 'EG links · Lindenstraße 4 · Erika Mustermann' }],
			tenants: [{ id: tenantId, label: 'Erika Mustermann' }]
		});
	});

	it('labels a lease without tenants by unit and property alone', async () => {
		const db = await testDatabase();
		const { unitId } = await seedUnit(db, 'a', { propertyName: 'Haus', name: 'DG' });
		const lease = await createLease(db, contextA, leaseInput(unitId));
		if (!lease.ok) throw new Error('setup failed');
		expect((await loadDocumentLinkOptions(db, 'a')).leases).toEqual([
			{ id: lease.id, label: 'DG · Haus' }
		]);
	});

	it('does not leak into another account', async () => {
		const db = await testDatabase();
		const { unitId } = await seedUnit(db, 'b');
		const tenantId = await seedTenant(db, 'b');
		const lease = await createLease(db, contextB, leaseInput(unitId, { tenantIds: [tenantId] }));
		if (!lease.ok) throw new Error('setup failed');

		expect(await loadDocumentLinkOptions(db, 'a')).toEqual({
			properties: [],
			units: [],
			leases: [],
			tenants: []
		});
		const own = await loadDocumentLinkOptions(db, 'b');
		expect(own.properties).toHaveLength(1);
		expect(own.leases).toHaveLength(1);
	});
});

describe('documentRow', () => {
	it('keeps what the page shows and drops the storage key', () => {
		const createdAt = new Date('2026-10-20T10:00:00Z');
		const document: typeof documents.$inferSelect = {
			id: 'd1',
			accountId: 'a',
			name: 'Mietvertrag.pdf',
			mimeType: 'application/pdf',
			size: 1234,
			storageKey: 'a/d1',
			propertyId: 'p1',
			unitId: null,
			leaseId: 'l1',
			tenantId: null,
			uploadedBy: 'user-a',
			createdAt
		};
		expect(documentRow(document)).toEqual({
			id: 'd1',
			name: 'Mietvertrag.pdf',
			mimeType: 'application/pdf',
			size: 1234,
			createdAt,
			propertyId: 'p1',
			unitId: null,
			leaseId: 'l1',
			tenantId: null
		});
	});
});
