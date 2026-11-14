import {
	and,
	asc,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	lte,
	notExists,
	type SQL
} from 'drizzle-orm';
import { addDays, formatDate, today, type IsoDate } from '../dates';
import {
	closedStatuses,
	deletionDate,
	disclosureRows,
	DISCLOSURE_LINK_DAYS,
	householdSize,
	isOpenStatus,
	openStatuses,
	privacyNotice,
	type ProofKey,
	type SelfDisclosure
} from '../domain/applicants';
import { personName } from '../format';
import type { ApplicantInput, LettingInput } from '../forms/lettings';
import { formatCents, formatCentsPlain } from '../money';
import { addressLines, landlordAddress } from './accounts';
import { auditEntry, type AuditContext } from './audit';
import { generateToken, hashToken } from './auth';
import type { Database } from './db';
import { chunkIds, runBatch } from './db/batch';
import {
	applicants,
	auditLog,
	lettings,
	properties,
	tenants,
	units,
	type ApplicantStatus
} from './db/schema';
import { listLeases } from './leases';
import type { Report } from './pdf';
import { assertQuota } from './quotas';

// Neuvermietung: the landlord offers a unit that is or becomes free, collects Mietinteressenten
// with their Selbstauskunft and the proofs they showed, compares them and turns the chosen one
// into a tenant, whose lease form starts with the terms of the letting. Rejected applicants and
// closed lettings are deleted after the retention period by the hourly job (deleteExpired).

export type Letting = typeof lettings.$inferSelect;
export type Applicant = typeof applicants.$inferSelect;

type Place = { unit: { id: string; name: string }; property: { id: string; name: string } };
export type LettingWithPlace = Letting & Place;

/** "Wohnung 14 · Parkallee 8", for headings and the audit log. */
export function lettingLabel(letting: Place): string {
	return `${letting.unit.name} · ${letting.property.name}`;
}

const placeColumns = {
	unit: { id: units.id, name: units.name },
	property: { id: properties.id, name: properties.name }
};

export type LettingRow = LettingWithPlace & {
	/** Applicants by status. */
	counts: Partial<Record<ApplicantStatus, number>>;
	total: number;
	/** For a closed letting: the day it is deleted with its applicants. */
	deletesOn: IsoDate | null;
};

/** All lettings of the account, open ones first, each with its applicants counted by status. */
export async function listLettings(db: Database, accountId: string): Promise<LettingRow[]> {
	const [rows, statusRows] = await Promise.all([
		db
			.select({ letting: lettings, ...placeColumns })
			.from(lettings)
			.innerJoin(units, eq(units.id, lettings.unitId))
			.innerJoin(properties, eq(properties.id, units.propertyId))
			.where(eq(lettings.accountId, accountId)),
		db
			.select({ lettingId: applicants.lettingId, status: applicants.status })
			.from(applicants)
			.where(eq(applicants.accountId, accountId))
	]);
	return rows
		.map(({ letting, unit, property }) => {
			const own = statusRows.filter((row) => row.lettingId === letting.id);
			const counts: Partial<Record<ApplicantStatus, number>> = {};
			for (const row of own) counts[row.status] = (counts[row.status] ?? 0) + 1;
			return {
				...letting,
				unit,
				property,
				counts,
				total: own.length,
				deletesOn: letting.closedAt ? deletionDate(letting.closedAt) : null
			};
		})
		.sort(
			(a, b) =>
				Number(a.closedAt !== null) - Number(b.closedAt !== null) ||
				(b.closedAt ?? '').localeCompare(a.closedAt ?? '') ||
				b.createdAt.getTime() - a.createdAt.getTime()
		);
}

export async function getLetting(
	db: Database,
	accountId: string,
	lettingId: string
): Promise<LettingWithPlace | undefined> {
	const [row] = await db
		.select({ letting: lettings, ...placeColumns })
		.from(lettings)
		.innerJoin(units, eq(units.id, lettings.unitId))
		.innerJoin(properties, eq(properties.id, units.propertyId))
		.where(and(eq(lettings.accountId, accountId), eq(lettings.id, lettingId)));
	return row && { ...row.letting, unit: row.unit, property: row.property };
}

export type LettingTermsDefaults = {
	availableFrom: IsoDate | null;
	baseRent: number;
	operatingCostPrepayment: number;
	heatingCostPrepayment: number;
	securityDeposit: number;
};

/**
 * The terms a new letting of the unit starts with: the current rent of its latest lease as the
 * unit's main unit, free from the day after that lease ends. Zero without a lease.
 */
export async function lettingDefaults(
	db: Database,
	accountId: string,
	unitId: string
): Promise<LettingTermsDefaults> {
	const latest = (await listLeases(db, accountId, { unitId })).find(
		(lease) => lease.unitId === unitId
	);
	if (!latest) {
		return {
			availableFrom: null,
			baseRent: 0,
			operatingCostPrepayment: 0,
			heatingCostPrepayment: 0,
			securityDeposit: 0
		};
	}
	const date = today();
	return {
		availableFrom: latest.endDate && latest.endDate >= date ? addDays(latest.endDate, 1) : null,
		baseRent: latest.currentRent.baseRent,
		operatingCostPrepayment: latest.currentRent.operatingCostPrepayment,
		heatingCostPrepayment: latest.currentRent.heatingCostPrepayment,
		securityDeposit: latest.securityDeposit
	};
}

/**
 * The lease form's fields from a letting after the Zusage: its terms, the start (the day the unit
 * is free, or the accepted applicant's move-in when later) and the persons moving in. Empty when
 * the letting is not in the account.
 */
export async function lettingLeaseDefaults(
	db: Database,
	accountId: string,
	lettingId: string
): Promise<Record<string, string>> {
	const letting = await getLetting(db, accountId, lettingId);
	if (!letting) return {};
	const [accepted] = await db
		.select()
		.from(applicants)
		.where(
			and(
				eq(applicants.accountId, accountId),
				eq(applicants.lettingId, lettingId),
				eq(applicants.status, 'accepted')
			)
		);
	const starts = [letting.availableFrom, accepted?.moveInDate].filter(
		(day): day is string => Boolean(day) && day! >= today()
	);
	const persons = accepted ? householdSize(accepted) : null;
	return {
		baseRent: formatCentsPlain(letting.baseRent),
		operatingCostPrepayment: formatCentsPlain(letting.operatingCostPrepayment),
		heatingCostPrepayment: formatCentsPlain(letting.heatingCostPrepayment),
		securityDeposit: formatCentsPlain(letting.securityDeposit),
		...(starts.length ? { startDate: starts.sort().at(-1)! } : {}),
		...(persons ? { persons: String(persons) } : {})
	};
}

export type LettingSuggestion = {
	unit: { id: string; name: string };
	property: { id: string; name: string };
	/** The day the unit is free; null: it is vacant already. */
	freeFrom: IsoDate | null;
};

/** How far ahead an ending lease suggests a Neuvermietung. */
const SUGGESTION_DAYS = 120;

/**
 * Units that are vacant or whose lease ends within SUGGESTION_DAYS and that have no open letting:
 * the ones to offer next. Parking spaces only when they are rented on their own.
 */
export async function lettingSuggestions(
	db: Database,
	accountId: string
): Promise<LettingSuggestion[]> {
	const [unitRows, leaseList, open] = await Promise.all([
		db
			.select(placeColumns)
			.from(units)
			.innerJoin(properties, eq(properties.id, units.propertyId))
			.where(and(eq(units.accountId, accountId), isNull(properties.archivedAt)))
			.orderBy(asc(properties.name), asc(units.name)),
		listLeases(db, accountId),
		db
			.select({ unitId: lettings.unitId })
			.from(lettings)
			.where(and(eq(lettings.accountId, accountId), isNull(lettings.closedAt)))
	]);
	const date = today();
	const horizon = addDays(date, SUGGESTION_DAYS);
	const offered = new Set(open.map((row) => row.unitId));
	const rentedWith = new Set(leaseList.flatMap((lease) => lease.extraUnits.map((unit) => unit.id)));
	return unitRows.flatMap(({ unit, property }) => {
		if (offered.has(unit.id)) return [];
		const onUnit = leaseList.filter(
			(lease) => lease.unitId === unit.id || lease.extraUnits.some((extra) => extra.id === unit.id)
		);
		// A unit rented with another one (a parking space) goes with its main unit.
		if (onUnit.length > 0 && onUnit.every((lease) => lease.unitId !== unit.id)) return [];
		if (onUnit.length === 0 && rentedWith.has(unit.id)) return [];
		const running = onUnit.filter((lease) => !lease.endDate || lease.endDate >= date);
		if (running.some((lease) => !lease.endDate)) return [];
		// Taken again after the current lease: a lease that starts later covers it.
		const lastEnd =
			running
				.map((lease) => lease.endDate!)
				.sort()
				.at(-1) ?? null;
		if (lastEnd && lastEnd > horizon) return [];
		if (running.length > 0 && onUnit.some((lease) => lease.startDate > lastEnd!)) return [];
		return [{ unit, property, freeFrom: lastEnd ? addDays(lastEnd, 1) : null }];
	});
}

export type LettingResult =
	{ ok: true; id: string } | { ok: false; reason: 'unknown-unit' | 'open-exists' };

export async function createLetting(
	db: Database,
	context: AuditContext,
	input: LettingInput
): Promise<LettingResult> {
	const { accountId } = context;
	const [place] = await db
		.select(placeColumns)
		.from(units)
		.innerJoin(properties, eq(properties.id, units.propertyId))
		.where(and(eq(units.accountId, accountId), eq(units.id, input.unitId)));
	if (!place) return { ok: false, reason: 'unknown-unit' };
	if (await openLettingOfUnit(db, accountId, input.unitId)) {
		return { ok: false, reason: 'open-exists' };
	}
	await assertQuota(db, accountId, 'lettings');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(lettings).values({ id, accountId, ...input }),
		auditEntry(
			db,
			context,
			'letting',
			id,
			'create',
			`Neuvermietung ${lettingLabel(place)} angelegt`
		)
	]);
	return { ok: true, id };
}

/** The terms and notes; the unit stays. False when the letting is not in the account. */
export async function updateLetting(
	db: Database,
	context: AuditContext,
	lettingId: string,
	input: Omit<LettingInput, 'unitId'>
): Promise<boolean> {
	const letting = await getLetting(db, context.accountId, lettingId);
	if (!letting) return false;
	await runBatch(db, [
		db
			.update(lettings)
			.set({
				availableFrom: input.availableFrom,
				baseRent: input.baseRent,
				operatingCostPrepayment: input.operatingCostPrepayment,
				heatingCostPrepayment: input.heatingCostPrepayment,
				securityDeposit: input.securityDeposit,
				requiresWbs: input.requiresWbs,
				notes: input.notes
			})
			.where(and(eq(lettings.accountId, context.accountId), eq(lettings.id, lettingId))),
		auditEntry(
			db,
			context,
			'letting',
			lettingId,
			'update',
			`Neuvermietung ${lettingLabel(letting)} geändert`
		)
	]);
	return true;
}

/** Applicants still open when a letting closes get the Absage that day. */
function rejectOpen(db: Database, accountId: string, lettingId: string, date: IsoDate, only?: SQL) {
	return db
		.update(applicants)
		.set({ status: 'rejected', decidedOn: date })
		.where(
			and(
				eq(applicants.accountId, accountId),
				eq(applicants.lettingId, lettingId),
				inArray(applicants.status, [...openStatuses]),
				only
			)
		);
}

/**
 * Ends the search: the open applicants get the Absage, and the letting is deleted with all its
 * applicants after the retention period. False when it is not in the account or closed already.
 */
export async function closeLetting(
	db: Database,
	context: AuditContext,
	lettingId: string,
	date = today()
): Promise<boolean> {
	const letting = await getLetting(db, context.accountId, lettingId);
	if (!letting || letting.closedAt) return false;
	await runBatch(db, [
		rejectOpen(db, context.accountId, lettingId, date),
		db
			.update(lettings)
			.set({ closedAt: date })
			.where(and(eq(lettings.accountId, context.accountId), eq(lettings.id, lettingId))),
		auditEntry(
			db,
			context,
			'letting',
			lettingId,
			'update',
			`Neuvermietung ${lettingLabel(letting)} abgeschlossen`
		)
	]);
	return true;
}

/** The audit lines of applicants name them, so they go with the applicants. */
function applicantAuditDeletes(db: Database, accountId: string, ids: string[]) {
	return chunkIds(ids).map((group) =>
		db
			.delete(auditLog)
			.where(
				and(
					eq(auditLog.accountId, accountId),
					eq(auditLog.entity, 'applicant'),
					inArray(auditLog.entityId, group)
				)
			)
	);
}

/**
 * The audit deletes for the applicants of every letting on these units, for deleting a unit or
 * property: the database cascade takes the applicants, but not the lines that name them.
 */
export async function applicantAuditDeletesOnUnits(
	db: Database,
	accountId: string,
	unitIds: string[]
) {
	const rows = (
		await Promise.all(
			chunkIds(unitIds).map((group) =>
				db
					.select({ id: applicants.id })
					.from(applicants)
					.innerJoin(lettings, eq(lettings.id, applicants.lettingId))
					.where(and(eq(lettings.accountId, accountId), inArray(lettings.unitId, group)))
			)
		)
	).flat();
	return applicantAuditDeletes(
		db,
		accountId,
		rows.map((row) => row.id)
	);
}

/** Deletes the letting with all its applicants. False when it is not in the account. */
export async function deleteLetting(
	db: Database,
	context: AuditContext,
	lettingId: string
): Promise<boolean> {
	const letting = await getLetting(db, context.accountId, lettingId);
	if (!letting) return false;
	const ids = (
		await db
			.select({ id: applicants.id })
			.from(applicants)
			.where(and(eq(applicants.accountId, context.accountId), eq(applicants.lettingId, lettingId)))
	).map((row) => row.id);
	await runBatch(db, [
		...applicantAuditDeletes(db, context.accountId, ids),
		db
			.delete(lettings)
			.where(and(eq(lettings.accountId, context.accountId), eq(lettings.id, lettingId))),
		auditEntry(
			db,
			context,
			'letting',
			lettingId,
			'delete',
			`Neuvermietung ${lettingLabel(letting)} mit ${ids.length === 1 ? 'einem Mietinteressenten' : `${ids.length} Mietinteressenten`} gelöscht`
		)
	]);
	return true;
}

/** The applicants of a letting, in the order they were added. */
export async function listApplicants(
	db: Database,
	accountId: string,
	lettingId: string
): Promise<Applicant[]> {
	return db
		.select()
		.from(applicants)
		.where(and(eq(applicants.accountId, accountId), eq(applicants.lettingId, lettingId)))
		.orderBy(asc(applicants.createdAt));
}

export async function getApplicant(
	db: Database,
	accountId: string,
	lettingId: string,
	applicantId: string
): Promise<Applicant | undefined> {
	const [row] = await db
		.select()
		.from(applicants)
		.where(
			and(
				eq(applicants.accountId, accountId),
				eq(applicants.lettingId, lettingId),
				eq(applicants.id, applicantId)
			)
		);
	return row;
}

/** Undefined when the letting is not in the account or closed. */
export async function createApplicant(
	db: Database,
	context: AuditContext,
	lettingId: string,
	input: ApplicantInput
): Promise<string | undefined> {
	const letting = await getLetting(db, context.accountId, lettingId);
	if (!letting || letting.closedAt) return undefined;
	await assertQuota(db, context.accountId, 'applicants');
	const id = crypto.randomUUID();
	await runBatch(db, [
		db.insert(applicants).values({
			id,
			accountId: context.accountId,
			lettingId,
			...input,
			status: input.viewingAt ? 'viewing' : 'new'
		}),
		auditEntry(
			db,
			context,
			'applicant',
			id,
			'create',
			`Mietinteressent ${personName(input)} für ${lettingLabel(letting)} angelegt`
		)
	]);
	return id;
}

const byId = (accountId: string, id: string) =>
	and(eq(applicants.accountId, accountId), eq(applicants.id, id));

export async function updateApplicant(
	db: Database,
	context: AuditContext,
	applicant: Applicant,
	input: ApplicantInput
): Promise<void> {
	await runBatch(db, [
		db
			.update(applicants)
			.set({
				...input,
				// A viewing booked for someone new moves them on.
				status: applicant.status === 'new' && input.viewingAt ? 'viewing' : applicant.status
			})
			.where(byId(context.accountId, applicant.id)),
		auditEntry(
			db,
			context,
			'applicant',
			applicant.id,
			'update',
			`Mietinteressent ${personName(input)} geändert`
		)
	]);
}

/** The statuses the landlord sets by hand; the Zusage goes through acceptApplicant. */
export const manualStatuses = [...openStatuses, ...closedStatuses] as const;
export type ManualStatus = (typeof manualStatuses)[number];

export async function setApplicantStatus(
	db: Database,
	context: AuditContext,
	applicant: Applicant,
	status: ManualStatus,
	date = today()
): Promise<void> {
	await runBatch(db, [
		db
			.update(applicants)
			.set({ status, decidedOn: isOpenStatus(status) ? null : date })
			.where(byId(context.accountId, applicant.id)),
		auditEntry(
			db,
			context,
			'applicant',
			applicant.id,
			'update',
			`Mietinteressent ${personName(applicant)}: Status geändert`
		)
	]);
}

/** Records that a proof was shown today, or takes that back. */
export async function setProof(
	db: Database,
	context: AuditContext,
	applicant: Applicant,
	key: ProofKey,
	shown: boolean,
	date = today()
): Promise<void> {
	await runBatch(db, [
		db
			.update(applicants)
			.set({ [key]: shown ? date : null })
			.where(byId(context.accountId, applicant.id)),
		auditEntry(
			db,
			context,
			'applicant',
			applicant.id,
			'update',
			`Mietinteressent ${personName(applicant)}: Nachweise geändert`
		)
	]);
}

/** Deletes the applicant and the audit lines that name them. */
export async function deleteApplicant(
	db: Database,
	context: AuditContext,
	applicant: Applicant
): Promise<void> {
	await runBatch(db, [
		...applicantAuditDeletes(db, context.accountId, [applicant.id]),
		db.delete(applicants).where(byId(context.accountId, applicant.id)),
		auditEntry(db, context, 'letting', applicant.lettingId, 'delete', 'Mietinteressent gelöscht')
	]);
}

/** The path of the page where the applicant fills in the Selbstauskunft. */
export const disclosurePath = (token: string) => `/selbstauskunft/${token}`;

/**
 * A new secret link to the Selbstauskunft, valid DISCLOSURE_LINK_DAYS; it replaces an earlier one.
 * Only its hash is stored, so the token is shown once.
 */
export async function createDisclosureLink(
	db: Database,
	context: AuditContext,
	applicant: Applicant,
	now = Date.now()
): Promise<{ token: string; expiresAt: Date }> {
	const token = generateToken();
	const expiresAt = new Date(now + DISCLOSURE_LINK_DAYS * 24 * 60 * 60 * 1000);
	await runBatch(db, [
		db
			.update(applicants)
			.set({
				disclosureTokenHash: await hashToken(token),
				disclosureExpiresAt: expiresAt,
				disclosureSubmittedAt: null
			})
			.where(byId(context.accountId, applicant.id)),
		auditEntry(
			db,
			context,
			'applicant',
			applicant.id,
			'update',
			`Link zur Selbstauskunft für ${personName(applicant)} erstellt`
		)
	]);
	return { token, expiresAt };
}

export async function revokeDisclosureLink(
	db: Database,
	context: AuditContext,
	applicant: Applicant
): Promise<void> {
	await runBatch(db, [
		db
			.update(applicants)
			.set({ disclosureTokenHash: null, disclosureExpiresAt: null })
			.where(byId(context.accountId, applicant.id)),
		auditEntry(
			db,
			context,
			'applicant',
			applicant.id,
			'update',
			`Link zur Selbstauskunft für ${personName(applicant)} gesperrt`
		)
	]);
}

export type DisclosurePage = {
	applicant: Applicant;
	letting: LettingWithPlace;
	address: { street: string; postalCode: string; city: string };
	landlord: Awaited<ReturnType<typeof landlordAddress>>;
	/** Sent in already: the page thanks instead of asking. */
	submitted: boolean;
};

/**
 * What the link of the token opens, or undefined when it is unknown, expired, revoked, or its
 * letting is closed.
 */
export async function disclosureByToken(
	db: Database,
	token: string,
	now = Date.now()
): Promise<DisclosurePage | undefined> {
	if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.disclosureTokenHash, await hashToken(token)));
	if (!applicant?.disclosureExpiresAt || applicant.disclosureExpiresAt.getTime() <= now) {
		return undefined;
	}
	if (!isOpenStatus(applicant.status)) return undefined;
	const letting = await getLetting(db, applicant.accountId, applicant.lettingId);
	if (!letting || letting.closedAt) return undefined;
	const [property] = await db
		.select({
			street: properties.street,
			postalCode: properties.postalCode,
			city: properties.city
		})
		.from(properties)
		.where(eq(properties.id, letting.property.id));
	return {
		applicant,
		letting,
		address: property,
		landlord: await landlordAddress(db, applicant.accountId),
		submitted: applicant.disclosureSubmittedAt !== null
	};
}

/**
 * Saves the Selbstauskunft the applicant sent through the link; once only, a new link allows
 * another. False when the link no longer opens anything or was used.
 */
export async function submitDisclosure(
	db: Database,
	token: string,
	input: SelfDisclosure,
	now = Date.now()
): Promise<boolean> {
	const page = await disclosureByToken(db, token, now);
	if (!page || page.submitted) return false;
	const { applicant } = page;
	const status =
		applicant.status === 'new' || applicant.status === 'viewing' ? 'applied' : applicant.status;
	await runBatch(db, [
		db
			.update(applicants)
			.set({ ...input, status, disclosureSubmittedAt: new Date(now) })
			.where(byId(applicant.accountId, applicant.id)),
		auditEntry(
			db,
			{ accountId: applicant.accountId, userId: null },
			'applicant',
			applicant.id,
			'update',
			`Selbstauskunft von ${personName(input)} über den Link erhalten`
		)
	]);
	return true;
}

/**
 * The Zusage: the applicant (and the second person who signs) become tenants, the other open
 * applicants get the Absage and the letting closes. Returns the new tenants' ids; undefined when
 * the applicant is not open or the letting is closed.
 *
 * Two Zusagen at once, say a double click or two managers, both pass the checks before either
 * batch runs. So the batch claims the applicant itself: it sets the new tenant id only while the
 * applicant and the letting are still open, and every later statement runs only if that claim
 * holds. A batch that lost takes its tenants out again, and the outcome is read back.
 */
export async function acceptApplicant(
	db: Database,
	context: AuditContext,
	applicant: Applicant,
	date = today()
): Promise<{ tenantIds: string[] } | undefined> {
	const { accountId } = context;
	const letting = await getLetting(db, accountId, applicant.lettingId);
	if (!letting || letting.closedAt || !isOpenStatus(applicant.status)) return undefined;
	const people = [
		{
			salutation: applicant.salutation,
			firstName: applicant.firstName,
			lastName: applicant.lastName,
			birthDate: applicant.birthDate,
			email: applicant.email,
			phone: applicant.phone
		}
	];
	if (applicant.coFirstName && applicant.coLastName) {
		people.push({
			salutation: null,
			firstName: applicant.coFirstName,
			lastName: applicant.coLastName,
			birthDate: applicant.coBirthDate,
			email: null,
			phone: null
		});
	}
	await assertQuota(db, accountId, 'tenants', people.length);
	const tenantRows = people.map((person) => ({
		id: crypto.randomUUID(),
		accountId,
		...person,
		notes: `Aus der Neuvermietung ${lettingLabel(letting)} übernommen.`
	}));
	const tenantId = tenantRows[0].id;
	const claimed = exists(
		db
			.select({ id: applicants.id })
			.from(applicants)
			.where(and(byId(accountId, applicant.id), eq(applicants.tenantId, tenantId)))
	);
	const ofLetting = and(eq(lettings.accountId, accountId), eq(lettings.id, letting.id));
	await runBatch(db, [
		db.insert(tenants).values(tenantRows),
		db
			.update(applicants)
			.set({ status: 'accepted', decidedOn: date, tenantId })
			.where(
				and(
					byId(accountId, applicant.id),
					inArray(applicants.status, [...openStatuses]),
					exists(
						db
							.select({ id: lettings.id })
							.from(lettings)
							.where(and(ofLetting, isNull(lettings.closedAt)))
					)
				)
			),
		db.delete(tenants).where(
			and(
				eq(tenants.accountId, accountId),
				inArray(
					tenants.id,
					tenantRows.map((row) => row.id)
				),
				notExists(
					db
						.select({ id: applicants.id })
						.from(applicants)
						.where(and(byId(accountId, applicant.id), eq(applicants.tenantId, tenantId)))
				)
			)
		),
		rejectOpen(db, accountId, letting.id, date, claimed),
		db
			.update(lettings)
			.set({ closedAt: date })
			.where(and(ofLetting, isNull(lettings.closedAt), claimed))
	]);
	const [after] = await db
		.select({ tenantId: applicants.tenantId })
		.from(applicants)
		.where(byId(accountId, applicant.id));
	if (after?.tenantId !== tenantId) return undefined;
	await runBatch(db, [
		...tenantRows.map((row) =>
			auditEntry(db, context, 'tenant', row.id, 'create', `Mieter ${personName(row)} angelegt`)
		),
		auditEntry(
			db,
			context,
			'letting',
			letting.id,
			'update',
			`Neuvermietung ${lettingLabel(letting)}: Zusage an ${personName(applicant)}`
		)
	]);
	return { tenantIds: tenantRows.map((row) => row.id) };
}

/**
 * Deletes what the retention period is over for, in every account: applicants with an Absage or
 * withdrawn, and closed lettings with all their applicants, RETENTION_MONTHS after the day. The
 * audit lines that name the applicants go too; one line per account says how many. Returns the
 * number of applicants deleted.
 */
export async function deleteExpired(db: Database, date = today()): Promise<number> {
	// Three months are at least 89 days; the exact day comes from deletionDate.
	const before = addDays(date, -89);
	const [decided, closed] = await Promise.all([
		db
			.select({
				id: applicants.id,
				accountId: applicants.accountId,
				decidedOn: applicants.decidedOn
			})
			.from(applicants)
			.where(
				and(
					inArray(applicants.status, [...closedStatuses]),
					isNotNull(applicants.decidedOn),
					lte(applicants.decidedOn, before)
				)
			),
		db
			.select({ id: lettings.id, accountId: lettings.accountId, closedAt: lettings.closedAt })
			.from(lettings)
			.where(and(isNotNull(lettings.closedAt), lte(lettings.closedAt, before)))
	]);
	const dueApplicants = decided.filter((row) => deletionDate(row.decidedOn!) <= date);
	const dueLettings = closed.filter((row) => deletionDate(row.closedAt!) <= date);
	const lettingApplicants = dueLettings.length
		? (
				await Promise.all(
					chunkIds(dueLettings.map((row) => row.id)).map((ids) =>
						db
							.select({ id: applicants.id, accountId: applicants.accountId })
							.from(applicants)
							.where(inArray(applicants.lettingId, ids))
					)
				)
			).flat()
		: [];
	const byAccount = new Map<string, { applicants: Set<string>; lettings: string[] }>();
	const entry = (accountId: string) => {
		let value = byAccount.get(accountId);
		if (!value) byAccount.set(accountId, (value = { applicants: new Set(), lettings: [] }));
		return value;
	};
	for (const row of [...dueApplicants, ...lettingApplicants]) {
		entry(row.accountId).applicants.add(row.id);
	}
	for (const row of dueLettings) entry(row.accountId).lettings.push(row.id);

	let deleted = 0;
	for (const [accountId, due] of byAccount) {
		const ids = [...due.applicants];
		const context = { accountId, userId: null };
		await runBatch(db, [
			...applicantAuditDeletes(db, accountId, ids),
			...chunkIds(ids).map((group) =>
				db
					.delete(applicants)
					.where(and(eq(applicants.accountId, accountId), inArray(applicants.id, group)))
			),
			...chunkIds(due.lettings).map((group) =>
				db
					.delete(lettings)
					.where(and(eq(lettings.accountId, accountId), inArray(lettings.id, group)))
			),
			auditEntry(
				db,
				context,
				'letting',
				due.lettings[0] ?? accountId,
				'delete',
				`${ids.length === 1 ? 'Ein Mietinteressent' : `${ids.length} Mietinteressenten`}${due.lettings.length ? ` und ${due.lettings.length === 1 ? 'eine abgeschlossene Neuvermietung' : `${due.lettings.length} abgeschlossene Neuvermietungen`}` : ''} nach Ablauf der Frist gelöscht`
			)
		]);
		deleted += ids.length;
	}
	return deleted;
}

/** The open letting of the unit, if any: a unit has at most one at a time. */
export async function openLettingOfUnit(
	db: Database,
	accountId: string,
	unitId: string
): Promise<string | undefined> {
	const [row] = await db
		.select({ id: lettings.id })
		.from(lettings)
		.where(
			and(eq(lettings.accountId, accountId), eq(lettings.unitId, unitId), isNull(lettings.closedAt))
		);
	return row?.id;
}

/** The lettings of the units, for the "takes along" line of a unit or property deletion. */
export async function lettingsOnUnits(
	db: Database,
	accountId: string,
	unitIds: string[]
): Promise<{ lettings: number; applicants: number }> {
	if (unitIds.length === 0) return { lettings: 0, applicants: 0 };
	const rows = (
		await Promise.all(
			chunkIds(unitIds).map((ids) =>
				db
					.select({ id: lettings.id })
					.from(lettings)
					.where(and(eq(lettings.accountId, accountId), inArray(lettings.unitId, ids)))
			)
		)
	).flat();
	if (rows.length === 0) return { lettings: 0, applicants: 0 };
	const people = (
		await Promise.all(
			chunkIds(rows.map((row) => row.id)).map((ids) =>
				db
					.select({ id: applicants.id })
					.from(applicants)
					.where(and(eq(applicants.accountId, accountId), inArray(applicants.lettingId, ids)))
			)
		)
	).flat();
	return { lettings: rows.length, applicants: people.length };
}

/**
 * The Mieterselbstauskunft as PDF: blank to print and hand out at the viewing, or with the
 * applicant's answers. Either way with the terms and the landlord's Datenschutzhinweis.
 */
export async function disclosureReport(
	db: Database,
	accountId: string,
	letting: LettingWithPlace,
	applicant: Applicant | null
): Promise<{ report: Report; filename: string }> {
	const landlord = await landlordAddress(db, accountId);
	const [address] = await db
		.select({ street: properties.street, postalCode: properties.postalCode, city: properties.city })
		.from(properties)
		.where(eq(properties.id, letting.property.id));
	const sections = disclosureRows(applicant, letting);
	const terms = [
		`Kaltmiete ${formatCents(letting.baseRent)}`,
		letting.operatingCostPrepayment
			? `Betriebskosten ${formatCents(letting.operatingCostPrepayment)}`
			: '',
		letting.heatingCostPrepayment ? `Heizkosten ${formatCents(letting.heatingCostPrepayment)}` : ''
	].filter(Boolean);
	const blank = applicant === null;
	const name = applicant ? personName(applicant) : '';
	return {
		report: {
			title: 'Mieterselbstauskunft',
			subtitle: [
				`${letting.unit.name}, ${address.street}, ${address.postalCode} ${address.city}`,
				`${terms.join(', ')}${letting.availableFrom ? `; frei ab ${formatDate(letting.availableFrom)}` : ''}`,
				`Vermieter: ${addressLines(landlord).join(', ')}`
			],
			blocks: [
				{
					paragraph: blank
						? 'Bitte füllen Sie nur aus, was Sie angeben möchten. Weitere Angaben, etwa Nachweise zum Einkommen oder zur Bonität, brauchen Sie erst, wenn der Vermieter Ihnen die Wohnung anbieten möchte. Eine Kopie Ihres Ausweises ist nicht nötig.'
						: `Angaben von ${name}${applicant.disclosureSubmittedAt ? `, über den Link gesendet am ${formatDate(applicant.disclosureSubmittedAt.toISOString().slice(0, 10))}` : ''}.`
				},
				...sections.map((section) => ({
					table: {
						title: section.title,
						columns: [{ label: 'Angabe', width: 0.5 }, { label: blank ? '' : 'Antwort' }],
						rows: section.rows.map(([label, value]) => [label, blank ? ' ' : value || '–'])
					}
				})),
				...(blank
					? [{ paragraph: '\n\nOrt, Datum, Unterschrift: ______________________________________' }]
					: []),
				{ paragraph: 'Datenschutzhinweis' },
				...privacyNotice(landlord).map((paragraph) => ({ paragraph }))
			]
		},
		filename: blank
			? `Selbstauskunft ${letting.unit.name}.pdf`
			: `Selbstauskunft ${name} ${letting.unit.name}.pdf`
	};
}
