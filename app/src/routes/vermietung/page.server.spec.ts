import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { applicants, tenants } from '#lib/server/db/schema.ts';
import { getApplicant, listApplicants, listLettings } from '#lib/server/lettings.ts';
import { outcome, routeEvent, seedLease, seedUnit, testDatabase } from '#lib/server/testing.ts';
import * as applicantPage from './[id]/interessenten/[applicantId]/+page.server';
import * as filledPdf from './[id]/interessenten/[applicantId]/selbstauskunft/+server';
import * as lettingPage from './[id]/+page.server';
import * as blankPdf from './[id]/selbstauskunft/+server';
import * as listPage from './+page.server';
import * as newPage from './neu/+page.server';
import * as leasePage from '../vertraege/neu/+page.server';

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
	return outcome(() => handler(routeEvent(db, options)));
}

const offer = {
	baseRent: '815,00',
	operatingCostPrepayment: '160,00',
	heatingCostPrepayment: '140,00',
	securityDeposit: '2.445,00',
	availableFrom: '2027-02-01',
	notes: ''
};

async function createLetting() {
	const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 14', propertyName: 'Parkallee 8' });
	await seedLease(db, 'a', unitId, { endDate: '2027-01-31' });
	const created = await run(newPage.actions.create, { form: { unitId, ...offer } });
	expect(created).toMatchObject({ redirect: expect.stringMatching(/^\/vermietung\/[\w-]+$/) });
	const id = (created as { redirect: string }).redirect.split('/').at(-1)!;
	return { unitId, id };
}

describe('/vermietung', () => {
	it('lists the lettings and suggests the units that become free', async () => {
		const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 14' });
		await seedLease(db, 'a', unitId, { endDate: '2027-01-31' });
		expect(await run(listPage.load)).toMatchObject({
			data: {
				lettings: [],
				suggestions: [{ unit: { name: 'Wohnung 14' }, freeFrom: '2027-02-01' }]
			}
		});
	});

	it('starts a letting from the latest lease and refuses a second one for the unit', async () => {
		expect(await run(newPage.load, { url: '/vermietung/neu' })).toMatchObject({
			data: { defaults: { unitId: '' }, openLettingId: null }
		});
		const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 14' });
		await seedLease(db, 'a', unitId, { endDate: '2027-01-31' });
		expect(await run(newPage.load, { url: `/vermietung/neu?unitId=${unitId}` })).toMatchObject({
			data: {
				openLettingId: null,
				defaults: {
					unitId,
					availableFrom: '2027-02-01',
					baseRent: '600,00',
					operatingCostPrepayment: '150,00',
					heatingCostPrepayment: '50,00',
					securityDeposit: '1.800,00'
				}
			}
		});
		expect(await run(newPage.actions.create, { form: { unitId, baseRent: '' } })).toMatchObject({
			fail: 400,
			data: { errors: { baseRent: expect.any(String) } }
		});
		expect(
			await run(newPage.actions.create, { form: { unitId: 'fremd', ...offer } })
		).toMatchObject({ fail: 400, data: { errors: { unitId: 'Diese Einheit gibt es nicht.' } } });
		const created = await run(newPage.actions.create, { form: { unitId, ...offer } });
		expect(created).toMatchObject({ redirect: expect.any(String) });
		expect(await run(newPage.actions.create, { form: { unitId, ...offer } })).toMatchObject({
			fail: 400,
			data: {
				errors: { unitId: 'Für diese Einheit läuft schon eine Neuvermietung.' },
				values: { unitId, baseRent: '815,00' }
			}
		});
		const [letting] = await listLettings(db, 'a');
		expect(await run(newPage.load, { url: `/vermietung/neu?unitId=${unitId}` })).toMatchObject({
			data: { openLettingId: letting.id, defaults: { securityDeposit: '1.800,00' } }
		});
		// A unit without any lease starts with empty terms.
		const fresh = await seedUnit(db, 'a', { name: 'Neubau' });
		expect(
			await run(newPage.load, { url: `/vermietung/neu?unitId=${fresh.unitId}` })
		).toMatchObject({
			data: { defaults: { baseRent: '', securityDeposit: '', availableFrom: '' } }
		});
	});

	it('compares the applicants, takes new ones and closes or deletes the letting', async () => {
		const { id } = await createLetting();
		const params = { id };
		expect(await run(lettingPage.load, { params: { id: 'fremd' } })).toMatchObject({ error: 404 });
		expect(
			await run(lettingPage.actions.addApplicant, { params, form: { firstName: 'Anna' } })
		).toMatchObject({
			fail: 400,
			data: { errors: { lastName: expect.any(String) } }
		});
		expect(
			await run(lettingPage.actions.addApplicant, {
				params,
				form: { firstName: 'Anna', lastName: 'Berg', viewingAt: '2026-11-18T17:30' }
			})
		).toEqual({ data: { added: 'Anna Berg', viewing: '18.11.2026, 17:30' } });
		expect(
			await run(lettingPage.actions.addApplicant, {
				params,
				form: { firstName: 'Ben', lastName: 'Wolf' }
			})
		).toEqual({ data: { added: 'Ben Wolf', viewing: null } });
		const [anna] = await listApplicants(db, 'a', id);
		await db
			.update(applicants)
			.set({ netIncome: 350000, adults: 2, children: 1, creditProofOn: '2026-11-14' })
			.where(eq(applicants.id, anna.id));
		const loaded = await run(lettingPage.load, { params, url: `/vermietung/${id}?bearbeiten=1` });
		expect(loaded).toMatchObject({
			data: {
				warmRent: 111500,
				landlordComplete: false,
				deletesOn: null,
				editing: { baseRent: '815,00', requiresWbs: '' },
				applicants: [
					{
						name: 'Anna Berg',
						status: 'viewing',
						household: 3,
						proofs: { shown: 1, total: 3 },
						deletesOn: null
					},
					{ name: 'Ben Wolf', status: 'new', burden: null }
				]
			}
		});
		const rows = (loaded as { data: { applicants: { burden: number | null }[] } }).data.applicants;
		expect(rows[0].burden).toBeCloseTo(111500 / 350000);

		expect(
			await run(lettingPage.actions.update, { params, form: { ...offer, baseRent: 'viel' } })
		).toMatchObject({ fail: 400, data: { edit: true, errors: { baseRent: expect.any(String) } } });
		expect(
			await run(lettingPage.actions.update, {
				params,
				form: { ...offer, baseRent: '799,00', requiresWbs: 'on' }
			})
		).toEqual({ redirect: `/vermietung/${id}` });
		expect(
			await run(lettingPage.actions.update, { params: { id: 'fremd' }, form: offer })
		).toMatchObject({
			error: 404
		});
		expect(await run(lettingPage.actions.close, { params })).toEqual({ data: { closed: true } });
		expect(await run(lettingPage.actions.close, { params })).toMatchObject({ error: 404 });
		expect(
			await run(lettingPage.actions.addApplicant, {
				params,
				form: { firstName: 'C', lastName: 'D' }
			})
		).toMatchObject({ error: 404 });
		expect(
			await run(lettingPage.load, { params, url: `/vermietung/${id}?bearbeiten=1` })
		).toMatchObject({
			data: {
				editing: null,
				deletesOn: '2027-02-14',
				applicants: [{ status: 'rejected', deletesOn: '2027-02-14' }, { status: 'rejected' }]
			}
		});

		const pdf = (await run(blankPdf.GET, { params })) as { data: Response };
		expect(pdf.data.headers.get('content-type')).toBe('application/pdf');
		expect(await run(blankPdf.GET, { params: { id: 'fremd' } })).toMatchObject({ error: 404 });

		expect(await run(lettingPage.actions.delete, { params })).toEqual({ redirect: '/vermietung' });
		expect(await run(lettingPage.actions.delete, { params })).toMatchObject({ error: 404 });
	});

	it('records an applicant, sends the link and gives the Zusage that opens the lease form', async () => {
		const { unitId, id } = await createLetting();
		await run(lettingPage.actions.addApplicant, {
			params: { id },
			form: { firstName: 'Miriam', lastName: 'Krüger', email: 'miriam@example.org' }
		});
		await run(lettingPage.actions.addApplicant, {
			params: { id },
			form: { firstName: 'Ben', lastName: 'Wolf' }
		});
		const [miriam, ben] = await listApplicants(db, 'a', id);
		const params = { id, applicantId: miriam.id };
		expect(await run(applicantPage.load, { params: { id, applicantId: 'fremd' } })).toMatchObject({
			error: 404
		});
		expect(await run(applicantPage.load, { params })).toMatchObject({
			data: {
				applicant: { firstName: 'Miriam', status: 'new' },
				landlordName: 'Konto A',
				burden: null,
				proofs: [
					{ key: 'idCheckedOn', on: null },
					{ key: 'creditProofOn', on: null },
					{ key: 'incomeProofOn', on: null }
				],
				link: { active: false },
				deletesOn: null,
				values: { firstName: 'Miriam', email: 'miriam@example.org', netIncome: '', insolvency: '' }
			}
		});
		const loaded = (await run(applicantPage.load, { params })) as { data: { applicant: object } };
		expect(loaded.data.applicant).toMatchObject({ disclosureTokenHash: undefined });

		const fields = {
			firstName: 'Miriam',
			lastName: 'Krüger',
			email: 'miriam@example.org',
			adults: '1',
			children: '1',
			netIncome: '3.800',
			insolvency: 'nein',
			moveInDate: '2027-03-01',
			coFirstName: 'Jan',
			coLastName: 'Krüger',
			rating: '5',
			viewingAt: '2026-11-18T17:30'
		};
		expect(
			await run(applicantPage.actions.update, { params, form: { ...fields, email: 'kaputt' } })
		).toMatchObject({ fail: 400, data: { errors: { email: expect.any(String) } } });
		expect(await run(applicantPage.actions.update, { params, form: fields })).toEqual({
			data: { saved: true }
		});
		expect(await run(applicantPage.load, { params })).toMatchObject({
			data: {
				applicant: { status: 'viewing', netIncome: 380000 },
				values: { netIncome: '3.800,00', insolvency: 'nein', rating: '5', adults: '1' }
			}
		});

		expect(
			await run(applicantPage.actions.status, { params, form: { status: 'accepted' } })
		).toMatchObject({ fail: 400 });
		expect(
			await run(applicantPage.actions.status, { params, form: { status: 'shortlisted' } })
		).toEqual({ data: { statusSet: true } });
		expect(
			await run(applicantPage.actions.proof, { params, form: { key: 'wbsProofOn', shown: '1' } })
		).toMatchObject({ fail: 400 });
		expect(
			await run(applicantPage.actions.proof, { params, form: { key: 'idCheckedOn', shown: '1' } })
		).toEqual({ data: { proofSet: true } });

		const link = (await run(applicantPage.actions.link, { params })) as {
			data: { linkUrl: string; linkExpires: string };
		};
		expect(link.data.linkUrl).toMatch(/^http:\/\/localhost\/selbstauskunft\/[\w-]{43}$/);
		expect(link.data.linkExpires).toBe('28.11.2026');
		expect(await run(applicantPage.load, { params })).toMatchObject({
			data: { link: { active: true, submittedAt: null } }
		});
		expect(await run(applicantPage.actions.revoke, { params })).toEqual({
			data: { revoked: true }
		});

		const pdf = (await run(filledPdf.GET, { params })) as { data: Response };
		expect(pdf.data.headers.get('content-disposition')).toContain('Selbstauskunft');
		expect(await run(filledPdf.GET, { params: { id, applicantId: 'fremd' } })).toMatchObject({
			error: 404
		});

		const accepted = await run(applicantPage.actions.accept, { params });
		expect(accepted).toMatchObject({ redirect: expect.stringContaining('/vertraege/neu?') });
		const query = new URL((accepted as { redirect: string }).redirect, 'http://localhost')
			.searchParams;
		expect(query.get('unitId')).toBe(unitId);
		expect(query.get('vermietung')).toBe(id);
		expect(query.getAll('tenantId')).toHaveLength(2);
		expect((await getApplicant(db, 'a', id, ben.id))?.status).toBe('rejected');
		expect(await run(applicantPage.actions.accept, { params })).toMatchObject({ fail: 400 });

		// The lease form starts with the letting's terms and the two new tenants.
		const leaseForm = await run(leasePage.load, {
			url: (accepted as { redirect: string }).redirect
		});
		expect(leaseForm).toMatchObject({
			data: {
				defaults: {
					unitId,
					baseRent: '815,00',
					securityDeposit: '2.445,00',
					startDate: '2027-03-01',
					persons: '2'
				},
				created: expect.arrayContaining([
					expect.objectContaining({ firstName: 'Miriam' }),
					expect.objectContaining({ firstName: 'Jan' })
				])
			}
		});
		const people = await db.select().from(tenants).where(eq(tenants.accountId, 'a'));
		expect(people).toHaveLength(2);

		// Closed now: nothing changes any more, but the record can still be deleted.
		const closedParams = { id, applicantId: ben.id };
		for (const action of [
			applicantPage.actions.update,
			applicantPage.actions.status,
			applicantPage.actions.proof
		]) {
			expect(
				await run(action, {
					params: closedParams,
					form: { ...fields, status: 'new', key: 'idCheckedOn', shown: '1' }
				})
			).toMatchObject({ fail: 400 });
		}
		expect(await run(applicantPage.actions.link, { params: closedParams })).toMatchObject({
			fail: 400
		});
		expect(await run(applicantPage.load, { params: closedParams })).toMatchObject({
			data: { deletesOn: '2027-02-14' }
		});
		expect(await run(applicantPage.actions.delete, { params: closedParams })).toEqual({
			redirect: `/vermietung/${id}`
		});
		expect(await listApplicants(db, 'a', id)).toHaveLength(1);
	});

	it('refuses a status that does not exist and a change after the Zusage', async () => {
		const { id } = await createLetting();
		await run(lettingPage.actions.addApplicant, {
			params: { id },
			form: { firstName: 'Anna', lastName: 'Berg' }
		});
		const [anna] = await listApplicants(db, 'a', id);
		const params = { id, applicantId: anna.id };
		expect(
			await run(applicantPage.actions.status, { params, form: { status: 'irgendwas' } })
		).toMatchObject({ fail: 400, data: { message: 'Diesen Status gibt es nicht.' } });
		await db.update(applicants).set({ status: 'accepted' }).where(eq(applicants.id, anna.id));
		expect(
			await run(applicantPage.actions.status, { params, form: { status: 'new' } })
		).toMatchObject({
			fail: 400,
			data: { message: 'Nach der Zusage lässt sich der Status nicht mehr ändern.' }
		});
		expect(await run(applicantPage.actions.link, { params })).toMatchObject({ fail: 400 });
	});
});
