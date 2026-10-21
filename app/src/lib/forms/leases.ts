import {
	heatingCostModels,
	leaseKinds,
	operatingCostModels,
	rentModels,
	terminatedByParties
} from '../server/db/schema';
import type { LeaseInput } from '../server/leases';
import { FormParser, type ParseResult } from './fields';

// Parses the lease form. The CSV import builds one FormData per row and uses the same parser.
// Whether the unit and tenants belong to the account is checked by the server module, not here.

export function parseLease(form: FormData): ParseResult<LeaseInput> {
	const parser = new FormParser<LeaseInput>(form);

	const unitId = parser.id('unitId');
	const extraUnitIds = parser.ids('extraUnitIds');
	const tenantIds = parser.ids('tenantIds');
	if (tenantIds.length === 0) parser.fail('tenantIds', 'Bitte wähle mindestens einen Mieter aus.');

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
	const operatingCostPrepayment = parser.money('operatingCostPrepayment', { required: false }) ?? 0;
	const heatingCostPrepayment = parser.money('heatingCostPrepayment', { required: false }) ?? 0;
	const securityDeposit = parser.money('securityDeposit', { required: false }) ?? 0;

	const persons =
		parser.number('persons', { required: false, integer: true, min: 0, max: 20 }) ?? 1;
	// The n-th working day of the month; § 556b BGB makes the third the default.
	const rentDueDay =
		parser.number('rentDueDay', { required: false, integer: true, min: 1, max: 20 }) ?? 3;

	const ledgerStart = parser.date('ledgerStart', { required: false });
	if (
		ledgerStart &&
		startDate &&
		(ledgerStart < startDate || (endDate !== null && ledgerStart > endDate))
	) {
		parser.fail('ledgerStart', 'Der Beginn des Mietkontos liegt außerhalb der Vertragslaufzeit.');
	}

	// The index base is only stored for an indexed rent; a value typed in and then forgotten by
	// switching the model back is dropped, but still has to be well-formed.
	const indexBaseMonth = parser.month('indexBaseMonth', { required: false });
	const indexBaseValue = parser.number('indexBaseValue', { required: false, min: 0 });
	if (indexBaseValue === 0) parser.fail('indexBaseValue', 'Der Indexwert muss größer als 0 sein.');
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
		operatingCostPrepayment,
		heatingCostPrepayment,
		securityDeposit,
		persons,
		rentDueDay,
		ledgerStart,
		indexBaseMonth: indexed ? indexBaseMonth : null,
		indexBaseValue: indexed ? indexBaseValue : null,
		terminatedAt,
		terminatedBy,
		notes
	}));
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

// Appended by the tenants-leases feature: the smaller forms of the lease pages.

import type { LeaseEndInput, LeasePersonsInput } from '../server/leases';

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

/** The opening balance of the ledger (Anfangssaldo), a signed amount; empty means none. */
export function parseOpeningBalance(
	form: FormData
): ParseResult<{ openingBalance: number | null }> {
	const parser = new FormParser<{ openingBalance: number | null }>(form);
	const openingBalance = parser.money('openingBalance', {
		required: false,
		min: -100_000_000_00
	});
	return parser.result(() => ({ openingBalance }));
}

/** "Personen ab Datum" on the lease overview. */
export function parseLeasePersons(form: FormData): ParseResult<LeasePersonsInput> {
	const parser = new FormParser<LeasePersonsInput>(form);
	const validFrom = parser.date('validFrom');
	const persons = parser.number('persons', { integer: true, min: 0, max: 20 });
	const note = parser.optionalText('note');
	return parser.result(() => ({ validFrom: validFrom!, persons: persons!, note }));
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
