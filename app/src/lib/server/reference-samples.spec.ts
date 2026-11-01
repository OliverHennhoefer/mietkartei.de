import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { referenceCases, referenceInput } from '../domain/reference-cases';
import { computeStatement } from '../domain/statement';
import { renderLetter } from './pdf';
import { statementLetter } from './statements';

// The Muster-Nebenkostenabrechnung of each reference case on mietkartei.de: the letter the app
// prints for the case's sample lease, as if approved on this day. The website build has no Node,
// so the PDFs are kept in the repository; `UPDATE_SAMPLES=1 npx vitest run reference-samples`
// rewrites them after a change to a case or to the letter.
const approvedOn = '2026-03-01';
const update = process.env.UPDATE_SAMPLES === '1';

describe('sample statements', () => {
	for (const c of referenceCases) {
		it(`${c.slug}: the sample PDF on mietkartei.de is current`, async () => {
			const input = referenceInput(c);
			// A landlord with an address and an account, as a real letter has them.
			input.landlord = {
				name: 'Eva Beispiel',
				street: 'Lindenallee 3',
				postalCode: c.property.postalCode,
				city: c.property.city,
				iban: 'DE02 1203 0000 0000 2020 51',
				bankName: 'Beispielbank'
			};
			const lease = computeStatement(input, { today: approvedOn }).leases.find(
				(entry) => entry.leaseId === c.sample
			);
			expect(lease, c.sample).toBeDefined();
			const approved = {
				...lease!,
				approvedOn,
				dueDate: lease!.balance > 0 ? null : addDays(approvedOn, 30),
				posted: lease!.balance
			};
			const bytes = Buffer.from(
				await renderLetter(statementLetter(approved), { date: new Date(`${approvedOn}T09:00:00Z`) })
			);
			const file = new URL(
				`../../../../website/rechenbeispiele/muster/${c.slug}.pdf`,
				import.meta.url
			);
			if (update) writeFileSync(file, bytes);
			expect(
				bytes.equals(readFileSync(file)),
				'outdated, run UPDATE_SAMPLES=1 npx vitest run reference-samples'
			).toBe(true);
		});
	}
});
