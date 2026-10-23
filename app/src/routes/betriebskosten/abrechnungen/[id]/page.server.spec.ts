import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { createStatement } from '#lib/server/statements.ts';
import {
	contextA,
	contextB,
	outcome,
	routeEvent,
	seedCostItem,
	seedLease,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { GET } from './pdf/[leaseId]/+server';
import { actions, load } from './+page.server';

let db: Database;
let statementId: string;
let leaseId: string;

/** A draft for 2025 of a property with one lease and one cost item, of the given account. */
async function seedStatement(context: typeof contextA) {
	const { propertyId, unitId } = await seedUnit(db, context.accountId);
	const lease = await seedLease(db, context.accountId, unitId);
	await seedCostItem(db, context.accountId, propertyId);
	const created = await createStatement(db, context, {
		propertyId,
		periodStart: '2025-01-01',
		periodEnd: '2025-12-31'
	});
	if (!created.ok) throw new Error(created.message);
	return { id: created.id, leaseId: lease };
}

beforeEach(async () => {
	// Within the deadline of § 556 Abs. 3 BGB for 2025, so approving needs no justification.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-03-02T10:00:00Z'));
	db = await testDatabase();
	({ id: statementId, leaseId } = await seedStatement(contextA));
});

afterEach(() => {
	vi.useRealTimers();
});

function act(action: keyof typeof actions, form: Record<string, string> = {}, id = statementId) {
	return outcome(() => actions[action](routeEvent(db, { params: { id }, form })));
}

function pdf(id = statementId, lease = leaseId) {
	return outcome(() => GET(routeEvent(db, { params: { id, leaseId: lease } })));
}

describe('abrechnungen/[id]', () => {
	it('shows the statement and answers 404 for one of another account', async () => {
		expect(
			await outcome(() => load(routeEvent(db, { params: { id: statementId } })))
		).toMatchObject({ data: { view: expect.anything(), today: '2026-03-02' } });
		const other = await seedStatement(contextB);
		expect(await outcome(() => load(routeEvent(db, { params: { id: other.id } })))).toMatchObject({
			error: 404
		});
		for (const action of ['approve', 'delete', 'correct', 'deliver'] as const) {
			expect(await act(action, {}, other.id), action).toMatchObject({ error: 404 });
		}
	});

	it('approves, prints, delivers and corrects a statement', async () => {
		expect(await pdf()).toMatchObject({ error: 404 });
		expect(await act('approve')).toEqual({ data: { approved: true } });
		expect(await act('approve')).toMatchObject({
			fail: 400,
			data: { message: expect.any(String) }
		});

		const printed = (await pdf()) as { data: Response };
		expect(printed.data.headers.get('Content-Type')).toBe('application/pdf');
		expect(new TextDecoder().decode((await printed.data.arrayBuffer()).slice(0, 5))).toBe('%PDF-');

		expect(await act('deliver', { leaseId, deliveredOn: '2026-03-02' })).toEqual({
			data: { delivered: leaseId, reversed: 0 }
		});
		expect(await act('deliver', { leaseId, deliveredOn: 'gestern' })).toMatchObject({ fail: 400 });
		// An approved statement is not a draft.
		expect(await act('delete')).toMatchObject({ fail: 400 });

		const corrected = await act('correct');
		expect(corrected).toEqual({
			redirect: expect.stringMatching(/^\/betriebskosten\/abrechnungen\//)
		});
		expect(corrected).not.toEqual({ redirect: `/betriebskosten/abrechnungen/${statementId}` });
	});

	it('deletes a draft', async () => {
		expect(await act('delete')).toEqual({ redirect: '/betriebskosten' });
		expect(
			await outcome(() => load(routeEvent(db, { params: { id: statementId } })))
		).toMatchObject({ error: 404 });
	});

	it('asks for the reason when a late statement is declared not the landlord’s fault', async () => {
		vi.setSystemTime(new Date('2027-02-01T10:00:00Z'));
		expect(await act('approve', { lateApprovalJustified: 'on' })).toMatchObject({ fail: 400 });
		expect(
			await act('approve', { lateApprovalJustified: 'on', note: 'Belege kamen spät' })
		).toEqual({
			data: { approved: true }
		});
	});
});
