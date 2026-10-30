import { describe, expect, it } from 'vitest';
import {
	settlementFigures,
	settlementRows,
	settlementText,
	type SettlementBalance,
	type SettlementInput
} from './deposit-settlement';

const paidIn: SettlementBalance = {
	received: 180000,
	interest: 0,
	returned: 0,
	withheld: 0,
	held: 180000
};

const input: SettlementInput = {
	date: '2026-02-15',
	interest: 1200,
	deductions: [{ label: 'Reparatur der Badtür', amount: 30000 }],
	offsetArrears: true
};

function figures(balance: SettlementBalance, settlement: SettlementInput, arrears: number) {
	const result = settlementFigures(balance, settlement, arrears);
	if (!result.ok) throw new Error(result.message);
	return result.figures;
}

const plain = (text: string) => text.replaceAll(' ', ' ');

describe('settlementFigures', () => {
	it('adds the interest, takes the Einbehalte and the arrears and pays back the rest', () => {
		expect(figures(paidIn, input, 80000)).toMatchObject({
			available: 181200,
			deducted: 30000,
			offset: 80000,
			remaining: 0,
			payout: 71200
		});
		// Without the offset the arrears stay on the ledger.
		expect(figures(paidIn, { ...input, offsetArrears: false }, 80000)).toMatchObject({
			offset: 0,
			remaining: 80000,
			payout: 151200
		});
		// A credit on the ledger is no arrear.
		expect(figures(paidIn, input, -5000)).toMatchObject({ arrears: 0, payout: 151200 });
	});

	it('offsets only as far as the deposit reaches', () => {
		expect(figures(paidIn, input, 200000)).toMatchObject({
			offset: 151200,
			remaining: 48800,
			payout: 0
		});
	});

	it('refuses Einbehalte above the deposit and a deposit already gone', () => {
		const tooMuch = settlementFigures(
			paidIn,
			{ ...input, deductions: [{ label: 'Schaden', amount: 190000 }] },
			0
		);
		expect(tooMuch).toMatchObject({ ok: false });
		expect(!tooMuch.ok && plain(tooMuch.message)).toContain(
			'übersteigen die Kaution von 1.812,00 €'
		);
		const empty = { ...paidIn, returned: 180000, held: 0 };
		expect(settlementFigures(empty, { ...input, interest: 0 }, 0)).toMatchObject({
			ok: false,
			message: 'Es ist keine Kaution mehr abzurechnen.'
		});
	});
});

describe('the letter', () => {
	it('lists the items and names the payout and the offset', () => {
		const balance = { ...paidIn, interest: 300, returned: 10000, withheld: 5000, held: 165300 };
		const result = figures(balance, input, 200000);
		expect(settlementRows(result).map((row) => row.map(plain))).toEqual([
			['Eingezahlte Kaution', '1.800,00 €'],
			['Zinsen', '15,00 €'],
			['Bereits zurückgezahlt', '-100,00 €'],
			['Bereits einbehalten', '-50,00 €'],
			['Einbehalt: Reparatur der Badtür', '-300,00 €'],
			['Verrechnet mit dem Mietrückstand', '-1.365,00 €']
		]);
		const text = plain(
			settlementText({
				tenants: [{ salutation: 'Herr', firstName: 'Max', lastName: 'Muster' }],
				unitName: 'EG links',
				endDate: '2025-12-31',
				figures: result,
				iban: 'DE02 1203 0000 0000 2020 51'
			})
		);
		const paragraphs = text.split('\n\n');
		expect(paragraphs[0]).toBe('Guten Tag Herr Muster,');
		expect(paragraphs[1]).toContain('endete am 31.12.2025');
		expect(paragraphs[2]).toContain('vollständig verrechnet');
		expect(paragraphs[3]).toContain('noch ausstehende Betriebskostenabrechnung');
		expect(paragraphs[4]).toBe(
			'Ihren Mietrückstand von 2.000,00 € haben wir mit der Kaution verrechnet, soweit sie reicht. ' +
				'Danach bleibt ein Rückstand von 635,00 €; bitte überweisen Sie ihn auf unser Konto mit der ' +
				'IBAN DE02 1203 0000 0000 2020 51.'
		);
	});

	it('announces the payout when money is left', () => {
		const text = plain(
			settlementText({
				tenants: [],
				unitName: 'EG links',
				endDate: '2025-12-31',
				figures: figures(paidIn, { ...input, deductions: [] }, 80000),
				iban: null
			})
		);
		expect(text.split('\n\n')).toHaveLength(4);
		expect(text).toContain('Den verbleibenden Betrag von 1.012,00 € überweisen wir Ihnen');
		expect(text).toContain('haben wir mit der Kaution verrechnet.');
	});
});
