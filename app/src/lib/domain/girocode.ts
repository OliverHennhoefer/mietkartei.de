import { encode } from 'uqr';
import { formatCents } from '../money';
import { formatIban, normalizeIban, normalizeText } from './bank-matching';

// GiroCode: the EPC QR code for a SEPA credit transfer (EPC069-12, version 002). A banking app
// that scans it fills in recipient, IBAN, amount and Verwendungszweck, so the tenant pays the
// right amount with a reference the Bankabgleich recognises. Letters that ask the tenant to pay
// (Nachzahlung, Mahnung, a rest after the Kautionsabrechnung) carry one next to the text.

/** What the code next to a letter shows: the payload to encode and the lines beside it. */
export type GiroCode = {
	payload: string;
	/** The transfer in words, for whoever cannot or will not scan. */
	lines: string[];
};

export type GiroCodeInput = {
	/** The landlord, as the beneficiary. */
	name: string;
	iban: string | null;
	/** In cents; nothing to pay gives no code. */
	amount: number;
	/** The Verwendungszweck, cut to the 140 characters the standard allows. */
	purpose: string;
};

const MAX_NAME = 70;
const MAX_PURPOSE = 140;
/** 999.999.999,99 €, the largest amount the standard allows. */
const MAX_AMOUNT = 99_999_999_999;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** `123456` → `EUR1234.56`, without the rounding of floating point. */
function epcAmount(cents: number): string {
	return `EUR${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * The GiroCode for a transfer to the landlord, or undefined when it cannot be one: no IBAN or one
 * that is not an IBAN, no name, or an amount that is not a positive number of cents.
 */
export function giroCode(input: GiroCodeInput): GiroCode | undefined {
	const iban = normalizeIban(input.iban);
	const name = normalizeText(input.name).slice(0, MAX_NAME).trim();
	const purpose = normalizeText(input.purpose).slice(0, MAX_PURPOSE).trim();
	if (!iban || !IBAN.test(iban) || !name) return undefined;
	if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) {
		return undefined;
	}
	// Service tag, version, UTF-8, SEPA credit transfer, no BIC (allowed in the EEA since 002),
	// name, IBAN, amount, no purpose code, no structured reference, the Verwendungszweck.
	const payload = [
		'BCD',
		'002',
		'1',
		'SCT',
		'',
		name,
		iban,
		epcAmount(input.amount),
		'',
		'',
		purpose
	].join('\n');
	return {
		payload,
		lines: [
			`Empfänger: ${name}`,
			`IBAN: ${formatIban(iban)}`,
			`Betrag: ${formatCents(input.amount)}`,
			...(purpose ? [`Verwendungszweck: ${purpose}`] : [])
		]
	};
}

/** The Verwendungszweck from its parts: what is paid, the units and the tenants' last names. */
export function paymentPurpose(what: string, unitNames: string[], lastNames: string[]): string {
	return [what, unitNames.join(' + '), lastNames.filter(Boolean).join(', ')]
		.filter(Boolean)
		.join(', ');
}

/**
 * The dark modules of the code, row by row, without a quiet zone: the caller leaves the white
 * margin of four modules around it. Error correction M, as the standard requires.
 */
export function giroCodeModules(payload: string): boolean[][] {
	const bytes = Array.from(new TextEncoder().encode(payload));
	return encode(bytes, { ecc: 'M', border: 0 }).data;
}
