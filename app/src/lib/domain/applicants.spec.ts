import { describe, expect, it } from 'vitest';
import {
	burdenTone,
	byStatus,
	deletionDate,
	disclosureRows,
	householdSize,
	isClosedStatus,
	isOpenStatus,
	privacyNotice,
	proofCount,
	proofsFor,
	rentBurden,
	warmRent,
	type SelfDisclosure
} from './applicants';

const terms = { baseRent: 80000, operatingCostPrepayment: 15000, heatingCostPrepayment: 10000 };

const answers: SelfDisclosure = {
	salutation: 'Frau',
	firstName: 'Miriam',
	lastName: 'Krüger',
	birthDate: '1991-04-07',
	email: 'miriam@example.org',
	phone: '0160 3318274',
	street: 'Brandenburger Straße 31',
	postalCode: '14467',
	city: 'Potsdam',
	adults: 1,
	children: 0,
	occupation: 'Ingenieurin',
	employer: 'Havelwerke GmbH',
	netIncome: 380000,
	pets: null,
	insolvency: false,
	hasWbs: null,
	moveInDate: '2027-02-01',
	coFirstName: null,
	coLastName: null,
	coBirthDate: null,
	coOccupation: null,
	coEmployer: null,
	message: null
};

describe('applicants', () => {
	it('tells open from decided statuses and orders the most promising first', () => {
		expect(isOpenStatus('viewing')).toBe(true);
		expect(isOpenStatus('accepted')).toBe(false);
		expect(isClosedStatus('withdrawn')).toBe(true);
		expect(isClosedStatus('shortlisted')).toBe(false);
		const statuses = ['rejected', 'new', 'accepted', 'shortlisted', 'withdrawn'] as const;
		expect([...statuses].sort(byStatus)).toEqual([
			'accepted',
			'shortlisted',
			'new',
			'withdrawn',
			'rejected'
		]);
	});

	it('deletes three months after the decision', () => {
		expect(deletionDate('2026-11-14')).toBe('2027-02-14');
		expect(deletionDate('2026-11-30')).toBe('2027-02-28');
	});

	it('computes the warm rent and the share of the income it takes', () => {
		expect(warmRent(terms)).toBe(105000);
		expect(rentBurden(terms, 350000)).toBeCloseTo(0.3);
		expect(rentBurden(terms, null)).toBeNull();
		expect(rentBurden(terms, 0)).toBeNull();
		expect(
			rentBurden({ ...terms, baseRent: 0, operatingCostPrepayment: 0, heatingCostPrepayment: 0 }, 1)
		).toBeNull();
		expect(burdenTone(0.3)).toBe('success');
		expect(burdenTone(0.35)).toBe('warning');
		expect(burdenTone(0.41)).toBe('danger');
	});

	it('asks for the WBS only for geförderten Wohnraum and counts the proofs shown', () => {
		expect(proofsFor({ requiresWbs: false }).map((proof) => proof.key)).toEqual([
			'idCheckedOn',
			'creditProofOn',
			'incomeProofOn'
		]);
		expect(proofsFor({ requiresWbs: true })).toHaveLength(4);
		const shown = {
			idCheckedOn: '2026-11-10',
			creditProofOn: null,
			incomeProofOn: '2026-11-12',
			wbsProofOn: '2026-11-12'
		};
		expect(proofCount(shown, { requiresWbs: false })).toEqual({ shown: 2, total: 3 });
		expect(proofCount(shown, { requiresWbs: true })).toEqual({ shown: 3, total: 4 });
	});

	it('counts the household', () => {
		expect(householdSize({ adults: 2, children: 1 })).toBe(3);
		expect(householdSize({ adults: null, children: 2 })).toBe(2);
		expect(householdSize({ adults: null, children: null })).toBeNull();
	});

	it('names the landlord as controller in the Datenschutzhinweis', () => {
		const notice = privacyNotice({
			name: 'Erika Muster',
			street: 'Lindenstraße 4',
			postalCode: '10969',
			city: 'Berlin'
		});
		expect(notice[0]).toBe(
			'Verantwortlich für Ihre Angaben ist Erika Muster, Lindenstraße 4, 10969 Berlin.'
		);
		expect(notice.join(' ')).toContain('3 Monate nach der Absage gelöscht');
		expect(privacyNotice({ name: '', street: null, postalCode: null, city: null })[0]).toBe(
			'Verantwortlich für Ihre Angaben ist der Vermieter.'
		);
	});

	it('lists the questions blank or with the answers', () => {
		const blank = disclosureRows(null, { requiresWbs: false });
		expect(blank.map((section) => section.title)).toEqual([
			'Mietinteressent',
			'Weitere Person, die den Mietvertrag unterschreibt (falls vorhanden)',
			'Haushalt und Einkommen'
		]);
		expect(blank.flatMap((section) => section.rows).every(([, value]) => value === '')).toBe(true);
		expect(blank[2].rows.some(([label]) => label.includes('Wohnberechtigungsschein'))).toBe(false);

		const filled = disclosureRows(
			{ ...answers, coFirstName: 'Jan', coLastName: 'Krüger', hasWbs: true },
			{ requiresWbs: true }
		);
		const person = Object.fromEntries(filled[0].rows);
		const rows = Object.fromEntries(filled[2].rows);
		expect(filled[0].rows[0]).toEqual(['Name', 'Frau Miriam Krüger']);
		expect(filled[1].rows[0]).toEqual(['Name', 'Jan Krüger']);
		expect(person['Derzeitige Anschrift']).toBe('Brandenburger Straße 31, 14467 Potsdam');
		expect(person['Geburtsdatum']).toBe('07.04.1991');
		expect(rows['Monatliches Nettoeinkommen des Haushalts']).toMatch(/^3\.800,00\s€$/);
		expect(rows['Läuft ein Verbraucherinsolvenzverfahren?']).toBe('nein');
		expect(rows['Wohnberechtigungsschein vorhanden?']).toBe('ja');
		expect(rows['Einziehende Kinder']).toBe('0');
	});
});
