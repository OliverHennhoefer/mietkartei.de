import type { IsoDate } from '../dates';
import {
	heatingCostModels,
	leaseKinds,
	operatingCostModels,
	rentModels,
	terminatedByParties
} from '../server/db/schema';
import type {
	LeaseEndInput,
	LeaseInput,
	LeasePartyInput,
	LeasePersonsInput
} from '../server/leases';
import type { TenantInput } from '../server/tenants';
import { NEW_TENANT_PREFIX, newTenantOf } from '../new-tenant';
import { formDataOf, FormParser, type ParseResult } from './fields';
import { parseTenant } from './tenants';

// Parses the lease forms. Whether the unit and tenants belong to the account is checked by the
// server module, not here.

/** How many tenants, and how many extra units, one lease takes. */
export const MAX_LEASE_IDS = 50;

/** `new:` with a first and a last name of at most 100 characters each. */
const NEW_TENANT_VALUE_LENGTH = 4 + 100 + 1 + 100;

/**
 * The tenants typed into the lease form's select who do not exist yet, each with first and last
 * name checked like the tenant form; their address stays empty, so letters go to the rented unit.
 */
export function parseNewTenants(form: FormData): ParseResult<{ newTenants: TenantInput[] }> {
	const parser = new FormParser<{ newTenants: TenantInput[]; tenantIds?: undefined }>(form);
	const newTenants: TenantInput[] = [];
	for (const value of parser.ids('tenantIds', MAX_LEASE_IDS, NEW_TENANT_VALUE_LENGTH)) {
		const name = newTenantOf(value);
		if (!name) continue;
		const tenant = parseTenant(formDataOf(name));
		if (tenant.ok) newTenants.push(tenant.data);
		else parser.fail('tenantIds', 'Bitte gib den neuen Mieter mit Vor- und Nachnamen an.');
	}
	return parser.result(() => ({ newTenants }));
}

/**
 * The lease form. With `newTenants`, values for tenants still to create (see parseNewTenants)
 * count as chosen tenants; they are never part of `tenantIds`.
 */
export function parseLease(
	form: FormData,
	options: { newTenants?: boolean } = {}
): ParseResult<LeaseInput> {
	const parser = new FormParser<LeaseInput>(form);

	const unitId = parser.id('unitId');
	// Bounded per lease, so that the lease_units and lease_tenants rows stay within the quotas.
	const extraUnitIds = parser.ids('extraUnitIds', MAX_LEASE_IDS);
	const tenantValues = parser.ids('tenantIds', MAX_LEASE_IDS, NEW_TENANT_VALUE_LENGTH);
	const tenantIds = tenantValues.filter(
		(value) => !value.startsWith(NEW_TENANT_PREFIX) && value.length <= 64
	);
	const typed = options.newTenants
		? tenantValues.filter((value) => value.startsWith(NEW_TENANT_PREFIX)).length
		: 0;
	if (tenantIds.length + typed === 0) {
		parser.fail('tenantIds', 'Bitte wähle mindestens einen Mieter aus.');
	}

	const startDate = parser.date('startDate');
	const endDate = parser.date('endDate', { required: false });
	if (startDate && endDate && endDate < startDate) {
		parser.fail('endDate', 'Das Vertragsende liegt vor dem Beginn.');
	}

	const kind = parser.oneOf('kind', leaseKinds);
	const rentModel = parser.oneOf('rentModel', rentModels);
	const operatingCostModel = parser.oneOf('operatingCostModel', operatingCostModels);
	const heatingCostModel = parser.oneOf('heatingCostModel', heatingCostModels);

	const baseRent = parser.money('baseRent');
	const parkingRent = parseParkingRent(parser, baseRent);
	const operatingCostPrepayment = parser.money('operatingCostPrepayment', { required: false }) ?? 0;
	const heatingCostPrepayment = parser.money('heatingCostPrepayment', { required: false }) ?? 0;
	const securityDeposit = parser.money('securityDeposit', { required: false }) ?? 0;

	const persons =
		parser.number('persons', { required: false, integer: true, min: 0, max: 20 }) ?? 1;

	// The n-th working day of the month; § 556b BGB makes the third the default.
	const rentDueDay =
		parser.number('rentDueDay', { required: false, integer: true, min: 1, max: 20 }) ?? 3;

	// A ledger start after the end is allowed: no rent is charged then, and an opening balance holds
	// what was still owed. Ending a lease before its ledger start must not lock the edit form.
	const ledgerStart = parser.date('ledgerStart', { required: false });
	if (ledgerStart && startDate && ledgerStart < startDate) {
		parser.fail('ledgerStart', 'Das Mietkonto kann nicht vor dem Vertragsbeginn beginnen.');
	}

	// The index base is only stored for an indexed rent; a value typed in and then forgotten by
	// switching the model back is dropped, but still has to be well-formed.
	const indexBaseMonth = parser.month('indexBaseMonth', { required: false });
	const indexBaseValue = parser.number('indexBaseValue', { required: false, min: 0 });
	if (indexBaseValue === 0) parser.fail('indexBaseValue', 'Der Indexwert muss größer als 0 sein.');
	const indexBaseYear = parser.raw('indexBaseYear') || '2020';
	if (!/^(19|20)\d{2}$/.test(indexBaseYear)) {
		parser.fail('indexBaseYear', 'Bitte gib das Basisjahr mit vier Ziffern an, z. B. 2020.');
	}
	const indexed = rentModel === 'indexed';
	if (indexed && (indexBaseMonth === null || indexBaseValue === null)) {
		const message = 'Für eine Indexmiete brauchst du den Basismonat und den Indexwert.';
		if (indexBaseMonth === null) parser.fail('indexBaseMonth', message);
		if (indexBaseValue === null) parser.fail('indexBaseValue', message);
	}

	const terminatedAt = parser.date('terminatedAt', { required: false });
	const terminatedBy = parser.oneOf('terminatedBy', terminatedByParties, { required: false });
	if (terminatedAt && !terminatedBy) {
		parser.fail('terminatedBy', 'Bitte wähle aus, wer gekündigt hat.');
	} else if (terminatedBy && !terminatedAt) {
		parser.fail('terminatedAt', 'Bitte gib an, wann gekündigt wurde.');
	}

	const notes = parser.optionalText('notes', 2000);

	return parser.result(() => ({
		unitId: unitId!,
		extraUnitIds,
		tenantIds,
		startDate: startDate!,
		endDate,
		kind: kind!,
		rentModel: rentModel!,
		operatingCostModel: operatingCostModel!,
		heatingCostModel: heatingCostModel!,
		baseRent: baseRent!,
		parkingRent,
		operatingCostPrepayment,
		heatingCostPrepayment,
		securityDeposit,
		persons,
		rentDueDay,
		ledgerStart,
		indexBaseMonth: indexed ? indexBaseMonth : null,
		indexBaseValue: indexed ? indexBaseValue : null,
		indexBaseYear: indexed ? indexBaseYear : '2020',
		terminatedAt,
		terminatedBy,
		notes
	}));
}

/**
 * "davon Garage/Stellplatz": the part of the Kaltmiete for a garage or parking space rented with
 * the unit, empty for none. It cannot exceed the Kaltmiete it is part of.
 */
export function parseParkingRent<T extends { parkingRent: number }>(
	parser: FormParser<T>,
	baseRent: number | null
): number {
	const parkingRent = parser.money('parkingRent', { required: false }) ?? 0;
	if (baseRent !== null && parkingRent > baseRent) {
		parser.fail(
			'parkingRent',
			'Der Anteil für Garage/Stellplatz ist Teil der Kaltmiete und kann nicht höher sein.'
		);
	}
	return parkingRent;
}

/**
 * § 551 BGB caps the deposit of a residential lease at three monthly base rents. This is a hint
 * the page shows next to the form, not a validation error: the lease can still be saved.
 */
export function depositWarning(
	input: Pick<LeaseInput, 'kind' | 'baseRent' | 'securityDeposit'>
): string | undefined {
	if (input.kind !== 'residential') return undefined;
	if (input.securityDeposit <= 3 * input.baseRent) return undefined;
	return 'Die Kaution übersteigt drei Nettokaltmieten (§ 551 BGB).';
}

/**
 * The edit form changes everything but the units (end the lease and start a new one). The
 * amounts, deposit and persons it edits are the ones at the start of the lease; the changes after
 * it live on the Miethöhe tab and in the persons history. The current units are put into the form
 * data, so parseLease checks the whole lease as on creation.
 */
export function parseLeaseEdit(form: FormData, current: LeaseInput): ParseResult<LeaseInput> {
	const merged = new FormData();
	for (const [name, value] of form) merged.append(name, value);
	merged.set('unitId', current.unitId);
	merged.delete('extraUnitIds');
	for (const unitId of current.extraUnitIds) merged.append('extraUnitIds', unitId);
	return parseLease(merged);
}

export const openingBalanceSides = ['arrears', 'credit'] as const;

/**
 * The opening balance of the ledger (Anfangssaldo); empty means none. The lease form names its
 * side, a Rückstand or a Guthaben of the tenant, with an amount without a sign; without a side
 * (the import of a spreadsheet) the amount carries the sign: negative for a Guthaben.
 */
export function parseOpeningBalance(
	form: FormData
): ParseResult<{ openingBalance: number | null; openingBalanceSide: string | null }> {
	const parser = new FormParser<{
		openingBalance: number | null;
		openingBalanceSide: string | null;
	}>(form);
	const side = parser.oneOf('openingBalanceSide', openingBalanceSides, { required: false });
	const amount = parser.money('openingBalance', {
		required: false,
		min: side ? 0 : -100_000_000_00
	});
	const openingBalance = amount !== null && side === 'credit' ? -amount : amount;
	return parser.result(() => ({ openingBalance, openingBalanceSide: side }));
}

/** "Personen ab Datum" on the lease overview. */
export function parseLeasePersons(form: FormData): ParseResult<LeasePersonsInput> {
	const parser = new FormParser<LeasePersonsInput>(form);
	const validFrom = parser.date('validFrom');
	const persons = parser.number('persons', { integer: true, min: 0, max: 20 });
	const note = parser.optionalText('note');
	return parser.result(() => ({ validFrom: validFrom!, persons: persons!, note }));
}

/** A tenant joining the lease on the overview: the day is optional (from the start). */
export function parseLeasePartyAdd(
	form: FormData
): ParseResult<{ tenantId: string; joinedOn: IsoDate | null }> {
	const parser = new FormParser<{ tenantId: string; joinedOn: IsoDate | null }>(form);
	const tenantId = parser.text('tenantId', { max: 64 });
	const joinedOn = parser.date('joinedOn', { required: false });
	return parser.result(() => ({ tenantId: tenantId!, joinedOn }));
}

/** The days a tenant joined and left the lease, both optional. */
export function parseLeaseParty(form: FormData): ParseResult<LeasePartyInput> {
	const parser = new FormParser<LeasePartyInput>(form);
	const joinedOn = parser.date('joinedOn', { required: false });
	const leftOn = parser.date('leftOn', { required: false });
	if (joinedOn && leftOn && leftOn < joinedOn) {
		parser.fail('leftOn', 'Der Austritt liegt vor dem Eintritt.');
	}
	return parser.result(() => ({ joinedOn, leftOn }));
}

/** "Vertrag beenden" on the lease overview. */
export function parseLeaseEnd(form: FormData): ParseResult<LeaseEndInput> {
	const parser = new FormParser<LeaseEndInput>(form);
	const terminatedAt = parser.date('terminatedAt');
	const terminatedBy = parser.oneOf('terminatedBy', terminatedByParties);
	const endDate = parser.date('endDate');
	if (terminatedAt && endDate && endDate < terminatedAt) {
		parser.fail('endDate', 'Das Vertragsende liegt vor dem Eingang der Kündigung.');
	}
	const earlyEndAgreed = parser.flag('earlyEndAgreed');
	return parser.result(() => ({
		terminatedAt: terminatedAt!,
		terminatedBy: terminatedBy!,
		endDate: endDate!,
		earlyEndAgreed
	}));
}
