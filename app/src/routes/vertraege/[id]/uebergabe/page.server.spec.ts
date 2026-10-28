import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { auditLog, meterReadings, meters, units } from '#lib/server/db/schema.ts';
import { handoverReport, listHandovers } from '#lib/server/handovers.ts';
import { getLease } from '#lib/server/leases.ts';
import {
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { GET as pdf } from './[art]/+server';
import { actions, load } from './+page.server';

// The Übergabe tab: the move-in and move-out protocols of a lease, their readings and PDFs.

let db: Database;
let leaseId: string;
let meterId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
	db = await testDatabase();
	const { unitId, propertyId } = await seedUnit(db, 'a');
	await db.update(units).set({ rooms: 3 }).where(eq(units.id, unitId));
	const tenantId = await seedTenant(db, 'a', { lastName: 'Muster' });
	leaseId = await seedLease(db, 'a', unitId, {
		startDate: '2024-01-01',
		endDate: '2026-06-30',
		tenantIds: [tenantId]
	});
	[{ id: meterId }] = await db
		.insert(meters)
		.values({
			accountId: 'a',
			propertyId,
			unitId,
			kind: 'cold_water',
			serialNumber: '123',
			unit: 'm³'
		})
		.returning({ id: meters.id });
});

afterEach(() => {
	vi.useRealTimers();
});

async function page(query = '', id = leaseId) {
	const parent = { lease: await getLease(db, 'a', id) };
	return outcome(() =>
		load(routeEvent(db, { params: { id }, url: `/vertraege/${id}/uebergabe${query}`, parent }))
	);
}

function act(action: keyof typeof actions, form: Record<string, string> = {}, id = leaseId) {
	return outcome(() => actions[action](routeEvent(db, { params: { id }, form })));
}

const moveIn = {
	art: 'einzug',
	date: '2024-01-02',
	attendees: 'Vermieterin, Mieter',
	room1: 'Küche',
	condition1: 'good',
	room2: 'Bad',
	condition2: 'worn',
	roomNote2: 'Fuge am Waschbecken',
	key1: 'Wohnungstür',
	keyCount1: '2',
	notes: ''
};

describe('the Übergabe tab', () => {
	it('proposes the rooms, keys and meters of the lease', async () => {
		expect(await page()).toMatchObject({ data: { protocols: {}, editing: null, form: null } });
		const opened = (await page('?protokoll=einzug')) as {
			data: { form: { date: string; rooms: unknown[]; keys: unknown[] }; meters: unknown[] };
		};
		expect(opened.data.form.date).toBe('2024-01-01');
		expect(opened.data.form.rooms).toHaveLength(6);
		expect(opened.data.form.keys).toHaveLength(4);
		expect(opened.data.meters).toEqual([{ id: meterId, label: 'Kaltwasser 123', unit: 'm³' }]);
	});

	it('saves both protocols with their readings and prints the move-out against the move-in', async () => {
		expect(await act('save', { ...moveIn, [`reading-${meterId}`]: '12,5' })).toEqual({
			redirect: `/vertraege/${leaseId}/uebergabe`
		});
		const readings = await db.select().from(meterReadings);
		expect(readings).toMatchObject([
			{
				meterId,
				readAt: '2024-01-02',
				value: 12.5,
				note: 'Übergabeprotokoll Einzug vom 02.01.2024'
			}
		]);

		// The move-out starts from the move-in's rooms and keys and the lease end.
		const opened = (await page('?protokoll=auszug')) as {
			data: { form: { date: string; rooms: { name: string }[] } };
		};
		expect(opened.data.form.date).toBe('2026-06-30');
		expect(opened.data.form.rooms.map((room) => room.name)).toEqual(['Küche', 'Bad']);
		const moveOut = {
			...moveIn,
			art: 'auszug',
			date: '2026-06-30',
			condition2: 'damaged',
			roomNote2: 'Badtür gesplittert',
			keyCount1: '1',
			notes: 'Ein Schlüssel fehlt.'
		};
		expect(await act('save', { ...moveOut, date: '2023-12-31' })).toMatchObject({
			fail: 400,
			data: { message: expect.stringContaining('vor dem Einzug am 02.01.2024') }
		});
		expect(await act('save', moveOut)).toEqual({ redirect: `/vertraege/${leaseId}/uebergabe` });
		// Saving again changes the protocol.
		expect(await act('save', { ...moveOut, keyCount1: '0' })).toMatchObject({
			redirect: expect.any(String)
		});
		const protocols = await listHandovers(db, 'a', leaseId);
		expect(protocols.move_out?.keys).toEqual([{ label: 'Wohnungstür', count: 0 }]);
		expect(await act('save', { ...moveIn, date: '2026-07-01' })).toMatchObject({
			fail: 400,
			data: { message: expect.stringContaining('nach dem Auszug') }
		});

		const report = await handoverReport(db, 'a', leaseId, 'move_out');
		expect(report?.report.title).toBe('Übergabeprotokoll Auszug');
		expect(report?.filename).toBe('Übergabeprotokoll Auszug Muster 30.06.2026.pdf');
		expect(report?.report.blocks[0]).toMatchObject({
			table: { rows: [['Küche', 'In Ordnung', 'In Ordnung'], expect.anything()] }
		});
		const printed = (await outcome(() =>
			pdf(routeEvent(db, { params: { id: leaseId, art: 'auszug' } }))
		)) as { data: Response };
		expect(printed.data.headers.get('Content-Type')).toBe('application/pdf');
		expect(
			await outcome(() => pdf(routeEvent(db, { params: { id: leaseId, art: 'umzug' } })))
		).toMatchObject({ error: 404 });

		expect(await act('delete', { art: 'auszug' })).toEqual({
			redirect: `/vertraege/${leaseId}/uebergabe`
		});
		expect(await act('delete', { art: 'auszug' })).toMatchObject({ fail: 404 });
		expect(
			await outcome(() => pdf(routeEvent(db, { params: { id: leaseId, art: 'auszug' } })))
		).toMatchObject({ error: 404 });
		// The readings stay with the meter.
		expect(await db.select().from(meterReadings)).toHaveLength(1);
		const audit = (await db.select().from(auditLog)).map((entry) => entry.summary);
		expect(audit).toEqual(
			expect.arrayContaining([
				'Übergabeprotokoll Einzug vom 02.01.2024 angelegt',
				'Übergabeprotokoll Auszug vom 30.06.2026 geändert',
				'Übergabeprotokoll Auszug vom 30.06.2026 gelöscht'
			])
		);
	});

	it('refuses invalid rows, the future, an unknown kind and another account', async () => {
		expect(await act('save', { ...moveIn, art: 'umzug' })).toMatchObject({ fail: 400 });
		expect(
			await act('save', {
				...moveIn,
				room1: '',
				room2: '',
				roomNote2: '',
				key1: '',
				keyCount1: '2'
			})
		).toMatchObject({
			fail: 400,
			data: { errors: { room1: expect.any(String), key1: expect.any(String) } }
		});
		expect(await act('save', { ...moveIn, condition1: 'shiny' })).toMatchObject({
			fail: 400,
			data: { errors: { condition1: expect.any(String) } }
		});
		expect(await act('save', { ...moveIn, date: '2026-12-01' })).toMatchObject({
			fail: 400,
			data: {
				message: 'Das Protokoll kann nicht in der Zukunft liegen.',
				values: { room1: 'Küche' }
			}
		});
		const { unitId } = await seedUnit(db, 'b');
		const foreign = await seedLease(db, 'b', unitId);
		expect(await act('save', moveIn, foreign)).toMatchObject({ error: 404 });
		expect(await act('delete', { art: 'einzug' }, foreign)).toMatchObject({ fail: 404 });
		expect(
			await outcome(() => pdf(routeEvent(db, { params: { id: foreign, art: 'einzug' } })))
		).toMatchObject({ error: 404 });
	});
});
