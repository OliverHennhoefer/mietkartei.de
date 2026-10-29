import { describe, expect, it } from 'vitest';
import { referenceCases, referenceInput } from './reference-cases';
import { computeStatement } from './statement';

// A day before the deadline of the 2025 statements, so no case is late.
const today = '2026-03-01';

describe('reference cases', () => {
	for (const c of referenceCases) {
		const result = computeStatement(referenceInput(c), { today });

		it(`${c.slug}: every tenant pays the independently computed share`, () => {
			expect(result.property.warnings).toEqual([]);
			expect(result.property.landlordCo2Share).toBe(c.expected.landlordCo2Share);
			expect(result.leases.map((lease) => lease.leaseId).sort()).toEqual(
				Object.keys(c.expected.leases).sort()
			);
			for (const lease of result.leases) {
				const expected = c.expected.leases[lease.leaseId];
				const shares = Object.fromEntries(lease.lines.map((line) => [line.itemId, line.amount]));
				expect(shares, lease.leaseId).toEqual(expected.shares);
				expect(lease.prepaymentsTotal, lease.leaseId).toBe(expected.prepayments);
			}
		});

		it(`${c.slug}: the shares add up to the costs`, () => {
			const shares = result.leases.reduce((sum, lease) => sum + lease.costsTotal, 0);
			const { allocableTotal, landlordCo2Share, vacancyShare } = result.property;
			expect(shares + landlordCo2Share + vacancyShare).toBe(allocableTotal);
		});
	}

	it('the pages on mietkartei.de show the current result', async () => {
		const pages = referenceCases.map((c) => {
			const { property, leases } = computeStatement(referenceInput(c), { today });
			return {
				...c,
				result: {
					items: property.items,
					costsTotal: property.costsTotal,
					landlordCo2Share: property.landlordCo2Share,
					leases: leases.map((lease) => ({
						leaseId: lease.leaseId,
						occupancy: lease.occupancy,
						persons: lease.persons,
						lines: lease.lines.map(({ itemId, itemTotal, allocated, keyTotal, share, amount, co2 }) => ({
							itemId,
							itemTotal,
							allocated,
							keyTotal,
							share,
							amount,
							co2
						})),
						costsTotal: lease.costsTotal,
						prepaymentsTotal: lease.prepaymentsTotal,
						balance: lease.balance
					}))
				}
			};
		});
		// `npx vitest run -u reference-cases` rewrites the file after a change to a case.
		await expect(JSON.stringify(pages, null, '\t') + '\n').toMatchFileSnapshot(
			'../../../../website/rechenbeispiele/faelle.json'
		);
	});
});
