import { bankDataByIBAN } from 'bankdata-germany';

// Bank name and BIC of a German IBAN, from the Bankleitzahlendatei of the Deutsche Bundesbank as
// packaged by bankdata-germany (MIT). The Bundesbank publishes the file quarterly; Dependabot
// brings each new package version in, so the data is at most a few weeks behind.

/** `bic` is null for the few banks the file lists without one. */
export type BankOfIban = { name: string; bic: string | null };

/** The bank of a German IBAN (spaces allowed), or null for a foreign IBAN or an unknown BLZ. */
export function bankOfIban(iban: string): BankOfIban | null {
	const normalized = iban.replace(/\s+/g, '').toUpperCase();
	if (!normalized.startsWith('DE')) return null;
	const bank = bankDataByIBAN(normalized);
	if (!bank) return null;
	return { name: bank.bankName, bic: bank.bic || null };
}
