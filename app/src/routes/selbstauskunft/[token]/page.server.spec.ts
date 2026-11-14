import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import {
	createApplicant,
	createDisclosureLink,
	createLetting,
	getApplicant
} from '#lib/server/lettings.ts';
import { contextA, outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1] = {}) {
	return outcome(() => handler(routeEvent(db, { user: null, ...options })));
}

async function link() {
	const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 14' });
	const letting = await createLetting(db, contextA, {
		unitId,
		availableFrom: '2027-02-01',
		baseRent: 81500,
		operatingCostPrepayment: 16000,
		heatingCostPrepayment: 14000,
		securityDeposit: 244500,
		requiresWbs: false,
		notes: 'nur für den Vermieter'
	});
	if (!letting.ok) throw new Error(letting.reason);
	const id = (await createApplicant(db, contextA, letting.id, {
		salutation: null,
		firstName: 'Miriam',
		lastName: 'Krüger',
		birthDate: null,
		email: 'miriam@example.org',
		phone: null,
		street: null,
		postalCode: null,
		city: null,
		adults: null,
		children: null,
		occupation: null,
		employer: null,
		netIncome: null,
		pets: null,
		insolvency: null,
		hasWbs: null,
		moveInDate: null,
		coFirstName: null,
		coLastName: null,
		coBirthDate: null,
		coOccupation: null,
		coEmployer: null,
		message: null,
		viewingAt: null,
		notes: 'wirkte unpünktlich',
		rating: 2
	}))!;
	const applicant = (await getApplicant(db, 'a', letting.id, id))!;
	const { token } = await createDisclosureLink(db, contextA, applicant);
	return { token, lettingId: letting.id, id };
}

describe('/selbstauskunft/[token]', () => {
	it('shows the form without the landlord’s notes and takes the answers once', async () => {
		const { token, lettingId, id } = await link();
		const params = { token };
		const page = await run(load, { params });
		expect(page).toEqual({
			data: {
				state: 'open',
				offer: {
					unit: 'Wohnung 14',
					address: 'Lindenstraße 4, 10115 Berlin',
					baseRent: 81500,
					operatingCostPrepayment: 16000,
					heatingCostPrepayment: 14000,
					availableFrom: '2027-02-01',
					requiresWbs: false
				},
				landlordName: 'Konto A',
				notice: expect.arrayContaining([expect.stringContaining('Verantwortlich')]),
				values: expect.objectContaining({ firstName: 'Miriam', email: 'miriam@example.org' })
			}
		});
		expect(JSON.stringify(page)).not.toContain('unpünktlich');
		expect(JSON.stringify(page)).not.toContain('nur für den Vermieter');

		expect(
			await run(actions.default, { params, form: { firstName: '', lastName: 'K' } })
		).toMatchObject({
			fail: 400,
			data: { errors: { firstName: expect.any(String) } }
		});
		const answers = {
			firstName: 'Miriam',
			lastName: 'Krüger',
			adults: '1',
			netIncome: '3.800',
			insolvency: 'nein'
		};
		expect(await run(actions.default, { params, form: answers })).toEqual({ data: { sent: true } });
		expect(await getApplicant(db, 'a', lettingId, id)).toMatchObject({
			status: 'applied',
			netIncome: 380000,
			insolvency: false,
			notes: 'wirkte unpünktlich',
			rating: 2
		});
		expect(await run(load, { params })).toMatchObject({ data: { state: 'submitted' } });
		expect(await run(actions.default, { params, form: answers })).toEqual({
			fail: 400,
			data: { invalid: true }
		});
	});

	it('shows a notice for an unknown or expired link', async () => {
		expect(await run(load, { params: { token: 'unbekannt' } })).toEqual({
			data: { state: 'invalid' }
		});
		const { token } = await link();
		vi.setSystemTime(new Date('2026-11-29T10:00:00Z'));
		expect(await run(load, { params: { token } })).toEqual({ data: { state: 'invalid' } });
	});
});
