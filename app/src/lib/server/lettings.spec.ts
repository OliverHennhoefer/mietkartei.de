import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfDisclosure } from '../domain/applicants';
import type { ApplicantInput, LettingInput } from '../forms/lettings';
import type { Database } from './db';
import { accounts, applicants, auditLog, lettings, tenants, units } from './db/schema';
import {
	acceptApplicant,
	closeLetting,
	createApplicant,
	createDisclosureLink,
	createLetting,
	deleteApplicant,
	deleteExpired,
	deleteLetting,
	disclosureByToken,
	disclosureReport,
	getApplicant,
	getLetting,
	lettingDefaults,
	lettingLeaseDefaults,
	lettingsOnUnits,
	lettingSuggestions,
	listApplicants,
	listLettings,
	openLettingOfUnit,
	revokeDisclosureLink,
	setApplicantStatus,
	setProof,
	submitDisclosure,
	updateApplicant,
	updateLetting
} from './lettings';
import {
	contextA,
	contextB,
	integrityProblems,
	seedLease,
	seedUnit,
	testDatabase
} from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

function terms(unitId: string, overrides: Partial<LettingInput> = {}): LettingInput {
	return {
		unitId,
		availableFrom: '2027-02-01',
		baseRent: 81500,
		operatingCostPrepayment: 16000,
		heatingCostPrepayment: 14000,
		securityDeposit: 244500,
		requiresWbs: false,
		notes: null,
		...overrides
	};
}

const answers: SelfDisclosure = {
	salutation: 'Frau',
	firstName: 'Miriam',
	lastName: 'Krüger',
	birthDate: '1991-04-07',
	email: 'miriam@example.org',
	phone: null,
	street: null,
	postalCode: null,
	city: null,
	adults: 1,
	children: 1,
	occupation: 'Ingenieurin',
	employer: 'Havelwerke GmbH',
	netIncome: 380000,
	pets: null,
	insolvency: false,
	hasWbs: null,
	moveInDate: '2027-03-01',
	coFirstName: null,
	coLastName: null,
	coBirthDate: null,
	coOccupation: null,
	coEmployer: null,
	message: null
};

function person(firstName: string, lastName: string, overrides: Partial<ApplicantInput> = {}) {
	const empty = Object.fromEntries(Object.keys(answers).map((key) => [key, null]));
	return {
		...empty,
		firstName,
		lastName,
		viewingAt: null,
		notes: null,
		rating: null,
		...overrides
	} as ApplicantInput;
}

async function letting(overrides: Partial<LettingInput> = {}) {
	const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 14', propertyName: 'Parkallee 8' });
	const result = await createLetting(db, contextA, terms(unitId, overrides));
	if (!result.ok) throw new Error(result.reason);
	return { unitId, lettingId: result.id };
}

describe('lettings', () => {
	it('starts from the latest lease of the unit and suggests units that become free', async () => {
		const { unitId } = await seedUnit(db, 'a', { name: 'Wohnung 14' });
		const empty = await seedUnit(db, 'a', { name: 'Dachgeschoss', propertyName: 'Neubau' });
		const taken = await seedUnit(db, 'a', { name: 'EG', propertyName: 'Altbau' });
		await seedLease(db, 'a', taken.unitId);
		const later = await seedUnit(db, 'a', { name: 'OG', propertyName: 'Altbau' });
		await seedLease(db, 'a', later.unitId, { endDate: '2027-12-31' });
		expect(await lettingDefaults(db, 'a', unitId)).toEqual({
			availableFrom: null,
			baseRent: 0,
			operatingCostPrepayment: 0,
			heatingCostPrepayment: 0,
			securityDeposit: 0
		});
		await seedLease(db, 'a', unitId, { endDate: '2027-01-31' });
		expect(await lettingDefaults(db, 'a', unitId)).toEqual({
			availableFrom: '2027-02-01',
			baseRent: 60000,
			operatingCostPrepayment: 15000,
			heatingCostPrepayment: 5000,
			securityDeposit: 180000
		});
		const suggested = await lettingSuggestions(db, 'a');
		expect(suggested.map((row) => [row.unit.name, row.freeFrom])).toEqual([
			['Wohnung 14', '2027-02-01'],
			['Dachgeschoss', null]
		]);
		// A unit with an open letting, or a lease that follows, is no longer suggested.
		await createLetting(db, contextA, terms(empty.unitId));
		await seedLease(db, 'a', unitId, { startDate: '2027-02-01' });
		expect(await lettingSuggestions(db, 'a')).toEqual([]);
		expect(await lettingSuggestions(db, 'b')).toEqual([]);
	});

	it('leaves out parking spaces rented with a flat', async () => {
		const flat = await seedUnit(db, 'a', { name: 'Wohnung' });
		const [parking] = await db
			.insert(units)
			.values({ accountId: 'a', propertyId: flat.propertyId, name: 'Stellplatz', kind: 'parking' })
			.returning();
		await seedLease(db, 'a', flat.unitId, { extraUnitIds: [parking.id], endDate: '2026-10-31' });
		expect((await lettingSuggestions(db, 'a')).map((row) => row.unit.name)).toEqual(['Wohnung']);
	});

	it('creates, changes, closes and deletes a letting, one open per unit', async () => {
		const { unitId, lettingId } = await letting();
		expect(await createLetting(db, contextA, terms(unitId))).toEqual({
			ok: false,
			reason: 'open-exists'
		});
		expect(await createLetting(db, contextB, terms(unitId))).toEqual({
			ok: false,
			reason: 'unknown-unit'
		});
		expect(await openLettingOfUnit(db, 'a', unitId)).toBe(lettingId);
		const changed = terms(unitId, { baseRent: 79000, requiresWbs: true });
		expect(await updateLetting(db, contextA, lettingId, changed)).toBe(true);
		expect(await updateLetting(db, contextB, lettingId, changed)).toBe(false);
		expect(await getLetting(db, 'a', lettingId)).toMatchObject({
			baseRent: 79000,
			requiresWbs: true,
			unit: { name: 'Wohnung 14' },
			property: { name: 'Parkallee 8' }
		});
		expect(await getLetting(db, 'b', lettingId)).toBeUndefined();

		const first = (await createApplicant(db, contextA, lettingId, person('Anna', 'Berg')))!;
		const second = (await createApplicant(
			db,
			contextA,
			lettingId,
			person('Ben', 'Wolf', { viewingAt: '2026-11-18T17:30' })
		))!;
		expect((await listLettings(db, 'a'))[0]).toMatchObject({
			total: 2,
			counts: { new: 1, viewing: 1 },
			deletesOn: null
		});
		expect(await closeLetting(db, contextA, lettingId)).toBe(true);
		expect(await closeLetting(db, contextA, lettingId)).toBe(false);
		expect(
			(await listApplicants(db, 'a', lettingId)).map((row) => [row.id, row.status, row.decidedOn])
		).toEqual([
			[first, 'rejected', '2026-11-14'],
			[second, 'rejected', '2026-11-14']
		]);
		expect(await listLettings(db, 'a')).toMatchObject([
			{ closedAt: '2026-11-14', deletesOn: '2027-02-14' }
		]);
		// Closed, it takes no new applicants; a new one may start for the unit.
		expect(await createApplicant(db, contextA, lettingId, person('C', 'D'))).toBeUndefined();
		expect((await createLetting(db, contextA, terms(unitId))).ok).toBe(true);
		expect(await lettingsOnUnits(db, 'a', [unitId])).toEqual({ lettings: 2, applicants: 2 });
		expect(await lettingsOnUnits(db, 'a', [])).toEqual({ lettings: 0, applicants: 0 });

		expect(await deleteLetting(db, contextB, lettingId)).toBe(false);
		expect(await deleteLetting(db, contextA, lettingId)).toBe(true);
		expect(await listApplicants(db, 'a', lettingId)).toEqual([]);
		const log = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		// The lines that named the applicants are gone; the letting's own lines stay.
		expect(log.filter((row) => row.entity === 'applicant')).toEqual([]);
		expect(log.map((row) => row.summary)).toContain(
			'Neuvermietung Wohnung 14 · Parkallee 8 mit 2 Mietinteressenten gelöscht'
		);
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('keeps the applicants of a letting with their statuses, proofs and notes', async () => {
		const { lettingId } = await letting();
		const id = (await createApplicant(db, contextA, lettingId, person('Anna', 'Berg')))!;
		const applicant = (await getApplicant(db, 'a', lettingId, id))!;
		expect(applicant).toMatchObject({ status: 'new', decidedOn: null });
		expect(await getApplicant(db, 'b', lettingId, id)).toBeUndefined();

		await updateApplicant(db, contextA, applicant, {
			...person('Anna', 'Berg'),
			...answers,
			firstName: 'Anna',
			lastName: 'Berg',
			viewingAt: '2026-11-18T17:30',
			rating: 4
		});
		const updated = (await getApplicant(db, 'a', lettingId, id))!;
		expect(updated).toMatchObject({ status: 'viewing', netIncome: 380000, rating: 4 });

		await setApplicantStatus(db, contextA, updated, 'shortlisted');
		await setProof(db, contextA, updated, 'creditProofOn', true);
		expect(await getApplicant(db, 'a', lettingId, id)).toMatchObject({
			status: 'shortlisted',
			creditProofOn: '2026-11-14'
		});
		await setProof(db, contextA, updated, 'creditProofOn', false);
		await setApplicantStatus(db, contextA, updated, 'withdrawn');
		expect(await getApplicant(db, 'a', lettingId, id)).toMatchObject({
			status: 'withdrawn',
			decidedOn: '2026-11-14',
			creditProofOn: null
		});
		await setApplicantStatus(db, contextA, updated, 'applied');
		expect(await getApplicant(db, 'a', lettingId, id)).toMatchObject({ decidedOn: null });

		await deleteApplicant(db, contextA, updated);
		expect(await listApplicants(db, 'a', lettingId)).toEqual([]);
		const log = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(log.filter((row) => row.entity === 'applicant')).toEqual([]);
		expect(log.at(-1)?.summary).toBe('Mietinteressent gelöscht');
	});

	it('takes the Selbstauskunft once through the secret link while it is valid', async () => {
		const { lettingId } = await letting();
		const id = (await createApplicant(db, contextA, lettingId, person('Miriam', 'Krüger')))!;
		const applicant = (await getApplicant(db, 'a', lettingId, id))!;
		const { token, expiresAt } = await createDisclosureLink(db, contextA, applicant);
		expect(expiresAt.toISOString()).toBe('2026-11-28T10:00:00.000Z');
		expect(await disclosureByToken(db, 'kurz')).toBeUndefined();
		expect(await disclosureByToken(db, 'x'.repeat(43))).toBeUndefined();
		const page = (await disclosureByToken(db, token))!;
		expect(page).toMatchObject({
			submitted: false,
			letting: { id: lettingId },
			address: { street: 'Lindenstraße 4' },
			landlord: { name: 'Konto A' }
		});
		// The hash, not the token, is stored.
		const [stored] = await db.select().from(applicants).where(eq(applicants.id, id));
		expect(stored.disclosureTokenHash).not.toBe(token);

		expect(await submitDisclosure(db, token, answers)).toBe(true);
		expect(await getApplicant(db, 'a', lettingId, id)).toMatchObject({
			status: 'applied',
			netIncome: 380000,
			disclosureSubmittedAt: new Date('2026-11-14T10:00:00Z')
		});
		expect(await disclosureByToken(db, token)).toMatchObject({ submitted: true });
		expect(await submitDisclosure(db, token, answers)).toBe(false);
		expect(
			(await db.select().from(auditLog).where(eq(auditLog.entityId, id))).map((row) => row.summary)
		).toContain('Selbstauskunft von Miriam Krüger über den Link erhalten');

		// A new link allows another; it ends with its validity, when revoked or decided.
		const again = await createDisclosureLink(db, contextA, applicant);
		expect(await disclosureByToken(db, token)).toBeUndefined();
		expect(
			await disclosureByToken(db, again.token, Date.now() + 15 * 24 * 3600 * 1000)
		).toBeUndefined();
		await revokeDisclosureLink(db, contextA, applicant);
		expect(await disclosureByToken(db, again.token)).toBeUndefined();
		const third = await createDisclosureLink(db, contextA, applicant);
		await setApplicantStatus(db, contextA, applicant, 'rejected');
		expect(await disclosureByToken(db, third.token)).toBeUndefined();
		await setApplicantStatus(db, contextA, applicant, 'shortlisted');
		expect(await disclosureByToken(db, third.token)).toBeDefined();
		await closeLetting(db, contextA, lettingId);
		await setApplicantStatus(db, contextA, applicant, 'shortlisted');
		expect(await disclosureByToken(db, third.token)).toBeUndefined();
	});

	it('turns the chosen applicant into tenants and rejects the others', async () => {
		const { unitId, lettingId } = await letting();
		const chosen = (await createApplicant(
			db,
			contextA,
			lettingId,
			person('Miriam', 'Krüger', {
				...answers,
				coFirstName: 'Jan',
				coLastName: 'Krüger',
				coBirthDate: '1990-01-02',
				viewingAt: null,
				notes: null,
				rating: null
			})
		))!;
		await createApplicant(db, contextA, lettingId, person('Ben', 'Wolf'));
		const withdrawn = (await createApplicant(db, contextA, lettingId, person('Cem', 'Ay')))!;
		await setApplicantStatus(
			db,
			contextA,
			(await getApplicant(db, 'a', lettingId, withdrawn))!,
			'withdrawn',
			'2026-11-10'
		);
		const applicant = (await getApplicant(db, 'a', lettingId, chosen))!;
		const result = (await acceptApplicant(db, contextA, applicant))!;
		expect(result.tenantIds).toHaveLength(2);
		const created = await db.select().from(tenants).where(eq(tenants.accountId, 'a'));
		expect(created.map((row) => [row.firstName, row.lastName, row.birthDate, row.email])).toEqual([
			['Miriam', 'Krüger', '1991-04-07', 'miriam@example.org'],
			['Jan', 'Krüger', '1990-01-02', null]
		]);
		expect(created[0].notes).toBe('Aus der Neuvermietung Wohnung 14 · Parkallee 8 übernommen.');
		const rows = await listApplicants(db, 'a', lettingId);
		expect(rows.map((row) => [row.firstName, row.status, row.decidedOn, row.tenantId])).toEqual([
			['Miriam', 'accepted', '2026-11-14', result.tenantIds[0]],
			['Ben', 'rejected', '2026-11-14', null],
			['Cem', 'withdrawn', '2026-11-10', null]
		]);
		expect((await getLetting(db, 'a', lettingId))?.closedAt).toBe('2026-11-14');
		expect(await acceptApplicant(db, contextA, applicant)).toBeUndefined();
		expect(await lettingLeaseDefaults(db, 'a', lettingId)).toEqual({
			baseRent: '815,00',
			operatingCostPrepayment: '160,00',
			heatingCostPrepayment: '140,00',
			securityDeposit: '2.445,00',
			startDate: '2027-03-01',
			persons: '2'
		});
		expect(await lettingLeaseDefaults(db, 'b', lettingId)).toEqual({});
		// The tenants can be deleted; the applicant forgets them.
		await db.delete(tenants).where(eq(tenants.id, result.tenantIds[0]));
		expect((await getApplicant(db, 'a', lettingId, chosen))?.tenantId).toBeNull();
		expect(unitId).toBeTruthy();
	});

	it('starts the lease when the unit is free without a move-in and leaves out a past one', async () => {
		const { lettingId } = await letting({ availableFrom: '2026-10-01' });
		const id = (await createApplicant(db, contextA, lettingId, person('Ben', 'Wolf')))!;
		await acceptApplicant(db, contextA, (await getApplicant(db, 'a', lettingId, id))!);
		expect(await lettingLeaseDefaults(db, 'a', lettingId)).toEqual({
			baseRent: '815,00',
			operatingCostPrepayment: '160,00',
			heatingCostPrepayment: '140,00',
			securityDeposit: '2.445,00'
		});
	});

	it('deletes rejected applicants and closed lettings three months on', async () => {
		const { lettingId } = await letting();
		const keep = (await createApplicant(db, contextA, lettingId, person('Anna', 'Berg')))!;
		const gone = (await createApplicant(db, contextA, lettingId, person('Ben', 'Wolf')))!;
		await setApplicantStatus(
			db,
			contextA,
			(await getApplicant(db, 'a', lettingId, gone))!,
			'rejected',
			'2026-08-14'
		);
		// Account b: a letting closed on 30 November is deleted on 28 February.
		const other = await seedUnit(db, 'b');
		const closed = await createLetting(db, contextB, terms(other.unitId));
		if (!closed.ok) throw new Error(closed.reason);
		await createApplicant(db, contextB, closed.id, person('Cem', 'Ay'));
		await closeLetting(db, contextB, closed.id, '2026-11-30');

		expect(await deleteExpired(db, '2026-11-13')).toBe(0);
		expect(await deleteExpired(db)).toBe(1);
		expect((await listApplicants(db, 'a', lettingId)).map((row) => row.id)).toEqual([keep]);
		const log = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(log.filter((row) => row.entityId === gone)).toEqual([]);
		expect(log.at(-1)).toMatchObject({
			userId: null,
			summary: 'Ein Mietinteressent nach Ablauf der Frist gelöscht'
		});

		expect(await deleteExpired(db, '2027-02-27')).toBe(0);
		expect(await deleteExpired(db, '2027-02-28')).toBe(1);
		expect(await db.select().from(lettings).where(eq(lettings.accountId, 'b'))).toEqual([]);
		const [lineB] = (await db.select().from(auditLog).where(eq(auditLog.accountId, 'b'))).slice(-1);
		expect(lineB.summary).toBe(
			'Ein Mietinteressent und eine abgeschlossene Neuvermietung nach Ablauf der Frist gelöscht'
		);
		expect(await deleteExpired(db, '2027-03-01')).toBe(0);
		expect(await integrityProblems(db)).toEqual([]);
	});

	it('writes the Selbstauskunft as a PDF, blank or filled in', async () => {
		await db
			.update(accounts)
			.set({
				landlordName: 'Erika Muster',
				street: 'Hauptstraße 1',
				postalCode: '14467',
				city: 'Potsdam'
			})
			.where(eq(accounts.id, 'a'));
		const { lettingId } = await letting({ requiresWbs: true, availableFrom: null });
		const place = (await getLetting(db, 'a', lettingId))!;
		const blank = await disclosureReport(db, 'a', place, null);
		expect(blank.filename).toBe('Selbstauskunft Wohnung 14.pdf');
		expect(blank.report.subtitle).toEqual([
			'Wohnung 14, Lindenstraße 4, 10115 Berlin',
			expect.stringMatching(
				/^Kaltmiete 815,00\s€, Betriebskosten 160,00\s€, Heizkosten 140,00\s€$/
			),
			'Vermieter: Erika Muster, Hauptstraße 1, 14467 Potsdam'
		]);
		const id = (await createApplicant(db, contextA, lettingId, person('Miriam', 'Krüger')))!;
		const applicant = (await getApplicant(db, 'a', lettingId, id))!;
		const { token } = await createDisclosureLink(db, contextA, applicant);
		await submitDisclosure(db, token, answers);
		const filled = await disclosureReport(
			db,
			'a',
			place,
			(await getApplicant(db, 'a', lettingId, id))!
		);
		expect(filled.filename).toBe('Selbstauskunft Miriam Krüger Wohnung 14.pdf');
		expect(filled.report.blocks[0]).toEqual({
			paragraph: 'Angaben von Miriam Krüger, über den Link gesendet am 14.11.2026.'
		});
		const tables = filled.report.blocks.flatMap((block) => ('table' in block ? [block.table] : []));
		expect(tables.at(-1)?.rows).toContainEqual(['Wohnberechtigungsschein vorhanden?', '–']);
	});
});
