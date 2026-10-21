import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { firstOfMonth, monthOf, today } from '../dates';
import { formatCents } from '../money';
import type { Database } from './db';
import {
	auditLog,
	leaseTenants,
	leases,
	payments,
	properties,
	rentCharges,
	tenants,
	units
} from './db/schema';
import {
	commitImport,
	decodeContent,
	emptyImportContext,
	encodeContent,
	loadImportContext,
	planImport,
	proposeMapping,
	unmappedRequiredFields,
	type ImportContext,
	type ImportKind
} from './import';
import { createLease } from './leases';
import { QUOTAS } from './quotas';
import { contextA, leaseInput, seedTenant, seedUnit, testDatabase } from './testing';

// Plans a CSV string with the proposed mapping, as the page does.
function plan(kind: ImportKind, csv: string, context: ImportContext = emptyImportContext) {
	const rows = parseCsv(csv);
	const proposal = proposeMapping(kind, rows);
	return planImport(kind, rows, proposal.headerIndex, proposal.mapping, context);
}

function reasons(result: { rows: { row: number; reason?: string }[] }) {
	return result.rows.filter((row) => row.reason !== undefined).map((row) => [row.row, row.reason]);
}

describe('proposeMapping', () => {
	it('maps German column names onto the fields, exact names first', () => {
		const rows = parseCsv(
			'Objekt;Straße;PLZ;Ort;Wohnung;Fläche in m²;Bemerkung\nHaus;Weg 1;10115;Berlin;EG;72,5;x\n'
		);
		const proposal = proposeMapping('properties', rows);
		expect(proposal.headerIndex).toBe(0);
		expect(proposal.mapping).toEqual({
			propertyName: 0,
			street: 1,
			postalCode: 2,
			city: 3,
			unitName: 4,
			unitKind: null,
			floorArea: 5
		});
	});

	it('finds the header below preamble lines and matches "Kaltmiete (EUR)" by its first word', () => {
		const rows = parseCsv(
			'Export vom 01.01.2026\n\nObjekt;Einheit;Mieter;Beginn;Kaltmiete (EUR);Nebenkosten (EUR)\nHaus;EG;Muster, Erika;01.01.2025;650,00;150,00\n'
		);
		const proposal = proposeMapping('leases', rows);
		expect(proposal.headerIndex).toBe(1);
		expect(proposal.headers).toHaveLength(6);
		expect(proposal.mapping).toMatchObject({
			propertyName: 0,
			unitName: 1,
			tenantNames: 2,
			startDate: 3,
			baseRent: 4,
			operatingCostPrepayment: 5,
			endDate: null,
			openingBalance: null
		});
	});

	it('leaves everything unmapped when no header matches, and names the required fields', () => {
		const rows = parseCsv('Foo;Bar\n1;2\n');
		const proposal = proposeMapping('payments', rows);
		expect(Object.values(proposal.mapping).every((column) => column === null)).toBe(true);
		expect(unmappedRequiredFields('payments', proposal.mapping)).toEqual([
			'Objekt',
			'Einheit',
			'Datum',
			'Betrag'
		]);
		expect(unmappedRequiredFields('payments', { ...proposal.mapping, propertyName: 0 })).toEqual([
			'Einheit',
			'Datum',
			'Betrag'
		]);
	});
});

describe('planImport: properties and units', () => {
	const csv = [
		'Objekt;Straße;PLZ;Ort;Einheit;Art;Fläche',
		'Rosenweg 7;Rosenweg 7;10115;Berlin;EG links;Wohnung;72,5',
		'Rosenweg 7;Rosenweg 7;10115;Berlin;OG rechts;;64',
		'Rosenweg 7;Rosenweg 7;10115;Berlin;EG links;Wohnung;70',
		'Neues Haus;;;;EG;Wohnung;50',
		';;;;;;',
		'Rosenweg 7;Rosenweg 7;10115;Berlin;;Wohnung;50',
		'Rosenweg 7;Rosenweg 7;10115;Berlin;Keller;Lager;',
		'Haus;Lindenstraße 4;10115;Berlin;EG links;Wohnung;64',
		'Haus;Lindenstraße 4;10115;Berlin;Stellplatz 1;Stellplatz;'
	].join('\n');

	it('creates one property per name and one unit per row, reusing existing properties', () => {
		const context: ImportContext = {
			...emptyImportContext,
			properties: [{ id: 'p1', name: 'Haus', street: 'Lindenstraße 4' }],
			units: [{ id: 'u1', propertyId: 'p1', name: 'EG links', kind: 'apartment' }]
		};
		const result = plan('properties', csv, context);
		if (result.kind !== 'properties') throw new Error(result.kind);
		expect(result.properties).toEqual([
			{
				key: 'rosenweg 7|rosenweg 7',
				input: {
					name: 'Rosenweg 7',
					street: 'Rosenweg 7',
					postalCode: '10115',
					city: 'Berlin',
					buildingUse: 'residential',
					vacancyPersons: 1,
					notes: null
				}
			}
		]);
		expect(result.units).toEqual([
			{
				property: { key: 'rosenweg 7|rosenweg 7' },
				input: {
					name: 'EG links',
					kind: 'apartment',
					floorArea: 72.5,
					floor: null,
					rooms: null,
					notes: null
				}
			},
			{
				property: { key: 'rosenweg 7|rosenweg 7' },
				input: {
					name: 'OG rechts',
					kind: 'apartment',
					floorArea: 64,
					floor: null,
					rooms: null,
					notes: null
				}
			},
			{
				property: { id: 'p1' },
				input: {
					name: 'Stellplatz 1',
					kind: 'parking',
					floorArea: null,
					floor: null,
					rooms: null,
					notes: null
				}
			}
		]);
		expect(reasons(result)).toEqual([
			[4, 'Die Einheit „EG links“ in „Rosenweg 7“ steht doppelt in der Datei.'],
			[5, 'Straße: Bitte gib Straße und Hausnummer an.'],
			[6, 'Die Zeile ist leer.'],
			[7, 'Einheit: Bitte gib eine Bezeichnung an.'],
			[8, 'Art: Bitte wähle eine Art aus.'],
			[9, 'Die Einheit „EG links“ gibt es in „Haus“ schon.']
		]);
	});
});

describe('planImport: tenants', () => {
	it('validates every row like the tenant form and skips duplicates', () => {
		const csv = [
			'Anrede;Vorname;Nachname;E-Mail;PLZ',
			'Frau;Lena;Importmann;lena@example.org;',
			';Jonas;Beispiel;;10115',
			';;Ohnevorname;;',
			';Kurt;Falschmail;kurt(at)example.org;',
			';Lena;Importmann;;',
			';Erika;Mustermann;;',
			';Max;Plz;;123'
		].join('\n');
		const context: ImportContext = {
			...emptyImportContext,
			tenants: [{ id: 't1', firstName: 'Erika', lastName: 'Mustermann', email: null }]
		};
		const result = plan('tenants', csv, context);
		if (result.kind !== 'tenants') throw new Error(result.kind);
		expect(result.tenants).toEqual([
			{
				salutation: 'Frau',
				firstName: 'Lena',
				lastName: 'Importmann',
				email: 'lena@example.org',
				phone: null,
				street: null,
				postalCode: null,
				city: null,
				notes: null
			},
			{
				salutation: null,
				firstName: 'Jonas',
				lastName: 'Beispiel',
				email: null,
				phone: null,
				street: null,
				postalCode: '10115',
				city: null,
				notes: null
			}
		]);
		expect(reasons(result)).toEqual([
			[4, 'Vorname: Bitte fülle dieses Feld aus.'],
			[5, 'E-Mail: Bitte gib eine gültige E-Mail-Adresse an.'],
			[6, 'Der Mieter „Lena Importmann“ steht doppelt in der Datei.'],
			[7, 'Den Mieter „Erika Mustermann“ gibt es schon.'],
			[8, 'PLZ: Die Postleitzahl hat fünf Ziffern.']
		]);
	});
});

const leaseContext: ImportContext = {
	properties: [
		{ id: 'p1', name: 'Haus', street: 'Lindenstraße 4' },
		{ id: 'p2', name: 'Villa', street: 'Parkweg 2' }
	],
	units: [
		{ id: 'u1', propertyId: 'p1', name: 'EG links', kind: 'apartment' },
		{ id: 'u2', propertyId: 'p1', name: 'Stellplatz 1', kind: 'parking' },
		{ id: 'u3', propertyId: 'p2', name: 'Haus', kind: 'apartment' }
	],
	tenants: [
		{ id: 't1', firstName: 'Erika', lastName: 'Mustermann', email: 'erika@example.org' },
		{ id: 't2', firstName: 'Max', lastName: 'Mustermann', email: null },
		{ id: 't3', firstName: 'Jonas', lastName: 'Beispiel', email: null }
	],
	leases: [
		{
			id: 'l1',
			unitId: 'u1',
			startDate: '2020-01-01',
			endDate: '2024-12-31',
			tenantIds: ['t1'],
			extraUnitIds: []
		},
		{
			id: 'l2',
			unitId: 'u1',
			startDate: '2025-01-01',
			endDate: null,
			tenantIds: ['t2'],
			extraUnitIds: ['u2']
		},
		{
			id: 'l3',
			unitId: 'u3',
			startDate: '2025-01-01',
			endDate: null,
			tenantIds: ['t3'],
			extraUnitIds: []
		}
	],
	payments: [{ leaseId: 'l2', date: '2025-01-03', amount: 85000, note: 'Miete Januar' }]
};

describe('planImport: leases', () => {
	it('resolves units and tenants by name, parses German amounts and dates and the ledger start', () => {
		const csv = [
			'Objekt;Einheit;Mieter;Beginn;Ende;Kaltmiete;Nebenkosten;Heizkosten;Kaution;Personen;Mietkonto ab;Anfangssaldo;Art',
			'Villa;Haus;"Mustermann, Erika; Max Mustermann";01.03.2024;;1.200,00;200,00;100,00;3600;2;01.01.2026;-50,00;',
			'Haus;Stellplatz 1;Beispiel;2025-02-01;;45;;;;;;;',
			'Haus;Stellplatz 1;erika@example.org;01.01.2026;;45;;;;;;;Gewerbe',
			'Haus;Keller;Beispiel;01.01.2025;;100;;;;;;;',
			'Schloss;EG;Beispiel;01.01.2025;;100;;;;;;;',
			'Haus;EG links;Mustermann;01.01.2025;;100;;;;;;;',
			'Haus;EG links;Niemand;01.01.2025;;100;;;;;;;',
			'Haus;EG links;Beispiel;31.02.2025;;100;;;;;;;',
			'Haus;EG links;Beispiel;01.06.2025;31.05.2025;100;;;;;;;',
			'Haus;EG links;Beispiel;01.01.2025;;100;;;;;;;',
			'Haus;EG links;Beispiel;01.06.2025;;abc;;;;;;;',
			'Haus;EG links;Beispiel;01.06.2025;;100;;;;;;x;',
			'Haus;EG links;Beispiel;01.06.2025;;100;;;;;01.01.2025;;',
			'Haus;EG links;Beispiel;01.06.2025;;100;;;;;;100.000.000,01;'
		].join('\n');
		const result = plan('leases', csv, leaseContext);
		if (result.kind !== 'leases') throw new Error(result.kind);

		expect(result.leases.map((lease) => lease.row)).toEqual([2, 3, 4]);
		const [villa, parking, commercial] = result.leases;
		expect(villa.input).toMatchObject({
			unitId: 'u3',
			tenantIds: ['t1', 't2'],
			startDate: '2024-03-01',
			endDate: null,
			kind: 'residential',
			rentModel: 'fixed',
			operatingCostModel: 'prepayment',
			heatingCostModel: 'prepayment',
			baseRent: 120000,
			operatingCostPrepayment: 20000,
			heatingCostPrepayment: 10000,
			securityDeposit: 360000,
			persons: 2,
			rentDueDay: 3,
			ledgerStart: '2026-01-01'
		});
		expect(villa.openingBalance).toBe(-5000);
		// A parking space gets a parking lease; a lease that began in the past and has no ledger
		// start keeps its ledger from the current month, as the lease form proposes.
		expect(parking.input).toMatchObject({
			unitId: 'u2',
			tenantIds: ['t3'],
			kind: 'parking',
			baseRent: 4500,
			persons: 1,
			ledgerStart: firstOfMonth(monthOf(today()))
		});
		expect(parking.openingBalance).toBe(0);
		expect(commercial.input).toMatchObject({ kind: 'commercial', tenantIds: ['t1'] });

		expect(reasons(result)).toEqual([
			[5, 'Die Einheit „Keller“ gibt es in „Haus“ nicht.'],
			[6, 'Das Objekt „Schloss“ gibt es nicht.'],
			[
				7,
				'Der Mieter „Mustermann“ ist nicht eindeutig; gib „Nachname, Vorname“ oder die E-Mail-Adresse an.'
			],
			[8, 'Den Mieter „Niemand“ gibt es nicht.'],
			[9, 'Beginn: Bitte gib ein gültiges Datum an.'],
			[10, 'Ende: Das Vertragsende liegt vor dem Beginn.'],
			[11, 'Den Mietvertrag für „EG links“ in „Haus“ ab 01.01.2025 gibt es schon.'],
			[12, 'Kaltmiete: Bitte gib einen Betrag an, z. B. 650,00.'],
			[13, 'Anfangssaldo: Bitte gib einen Betrag an, z. B. 650,00.'],
			[14, 'Mietkonto ab: Das Mietkonto kann nicht vor dem Vertragsbeginn beginnen.'],
			[15, 'Anfangssaldo: Der Betrag ist zu hoch.']
		]);
	});
});

describe('planImport: payments', () => {
	it('finds the lease by property, unit, date and the tenant name when several match', () => {
		const csv = [
			'Datum;Objekt;Einheit;Mieter;Betrag;Verwendungszweck',
			'03.02.2025;Haus;EG links;;850,00;Miete Februar',
			'03.06.2024;Haus;EG links;;800,00;Miete Juni 2024',
			'03.01.2025;Haus;Stellplatz 1;;45,00;',
			'10.01.2025;Haus;EG links;;-20,00;Rückzahlung',
			'03.01.2025;Haus;EG links;;850,00;Miete Januar',
			'03.01.2020;Villa;Haus;;850,00;zu früh',
			'03.01.2025;Haus;Keller;;850,00;',
			'03.01.2025;Haus;EG links;;0,00;',
			'03.01.2025;Haus;EG links;;abc;',
			'1.1.;Haus;EG links;;850,00;',
			';Haus;EG links;;850,00;',
			'03.01.2025;Haus;EG links;Beispiel;850,00;'
		].join('\n');
		const result = plan('payments', csv, leaseContext);
		if (result.kind !== 'payments') throw new Error(result.kind);
		expect(result.payments).toEqual([
			{ leaseId: 'l2', date: '2025-02-03', amount: 85000, source: 'manual', note: 'Miete Februar' },
			{
				leaseId: 'l1',
				date: '2024-06-03',
				amount: 80000,
				source: 'manual',
				note: 'Miete Juni 2024'
			},
			// The parking space is an extra unit of lease l2.
			{ leaseId: 'l2', date: '2025-01-03', amount: 4500, source: 'manual', note: null },
			{ leaseId: 'l2', date: '2025-01-10', amount: -2000, source: 'manual', note: 'Rückzahlung' },
			// No lease of the villa ran in 2020, so the only lease of the unit takes the payment.
			{ leaseId: 'l3', date: '2020-01-03', amount: 85000, source: 'manual', note: 'zu früh' }
		]);
		expect(reasons(result)).toEqual([
			[6, `Die Zahlung über ${formatCents(85000)} vom 03.01.2025 für „EG links“ gibt es schon.`],
			[8, 'Die Einheit „Keller“ gibt es in „Haus“ nicht.'],
			[9, 'Betrag: Der Betrag darf nicht 0 sein.'],
			[10, 'Betrag: Bitte gib einen Betrag an, z. B. 650,00.'],
			[11, 'Datum: Bitte gib ein gültiges Datum an, z. B. 03.01.2025.'],
			[12, 'Datum: Bitte gib ein Datum an.'],
			[13, 'Für „EG links“ in „Haus“ gibt es keinen Mietvertrag mit einem Mieter „Beispiel“.']
		]);
	});

	it('keeps the limits of the payment form', () => {
		const csv = [
			'Datum;Objekt;Einheit;Mieter;Betrag;Verwendungszweck',
			`03.01.2025;Haus;EG links;;850,00;${'x'.repeat(201)}`,
			'03.01.2025;Haus;EG links;;100.000.000,01;',
			'03.01.2025;Haus;EG links;;-100.000.000,01;'
		].join('\n');
		const result = plan('payments', csv, leaseContext);
		if (result.kind !== 'payments') throw new Error(result.kind);
		expect(result.payments).toEqual([]);
		expect(reasons(result)).toEqual([
			[2, 'Verwendungszweck: Höchstens 200 Zeichen.'],
			[3, 'Betrag: Der Betrag ist zu hoch.'],
			[4, 'Betrag: Der Betrag darf nicht unter -100000000 € liegen.']
		]);
	});

	it('asks for the last name when two leases of the unit overlap on the date', () => {
		const context: ImportContext = {
			...leaseContext,
			leases: [
				{
					id: 'l1',
					unitId: 'u1',
					startDate: '2024-01-01',
					endDate: null,
					tenantIds: ['t1'],
					extraUnitIds: []
				},
				{
					id: 'l2',
					unitId: 'u1',
					startDate: '2025-01-01',
					endDate: null,
					tenantIds: ['t3'],
					extraUnitIds: []
				}
			],
			payments: []
		};
		const csv = [
			'Datum;Objekt;Einheit;Mieter;Betrag',
			'03.03.2025;Haus;EG links;;850,00',
			'03.03.2025;Haus;EG links;Beispiel;850,00',
			'03.03.2025;Haus;EG links;Mustermann, Erika;850,00'
		].join('\n');
		const result = plan('payments', csv, context);
		if (result.kind !== 'payments') throw new Error(result.kind);
		expect(result.payments.map((payment) => payment.leaseId)).toEqual(['l2', 'l1']);
		expect(reasons(result)).toEqual([
			[
				2,
				'Zu „EG links“ in „Haus“ passen am 03.03.2025 mehrere Mietverträge; gib den Nachnamen des Mieters an.'
			]
		]);
	});
});

describe('commitImport', () => {
	let db: Database;

	beforeEach(async () => {
		db = await testDatabase();
	});

	async function run(kind: ImportKind, csv: string) {
		const context = await loadImportContext(db, 'a', kind);
		return commitImport(db, contextA, plan(kind, csv, context));
	}

	it('creates properties and units in one batch with an import audit entry', async () => {
		const summary = await run(
			'properties',
			'Objekt;Straße;PLZ;Ort;Einheit;Fläche\nRosenweg 7;Rosenweg 7;10115;Berlin;EG;72,5\nRosenweg 7;Rosenweg 7;10115;Berlin;OG;64\nRosenweg 7;Rosenweg 7;10115;Berlin;;\n'
		);
		expect(summary).toMatchObject({
			kind: 'properties',
			count: 2,
			created: '1 Objekt und 2 Einheiten angelegt',
			skipped: [{ row: 4, reason: 'Einheit: Bitte gib eine Bezeichnung an.' }]
		});
		const propertyRows = await db.select().from(properties).where(eq(properties.accountId, 'a'));
		expect(propertyRows).toMatchObject([{ name: 'Rosenweg 7', city: 'Berlin' }]);
		const unitRows = await db.select().from(units).where(eq(units.accountId, 'a'));
		expect(unitRows.map((unit) => [unit.propertyId, unit.name, unit.floorArea])).toEqual([
			[propertyRows[0].id, 'EG', 72.5],
			[propertyRows[0].id, 'OG', 64]
		]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit).toMatchObject([
			{
				entity: 'import',
				action: 'import',
				userId: 'user-a',
				summary: 'CSV-Import: 1 Objekt und 2 Einheiten angelegt, 1 Zeile übersprungen'
			}
		]);

		// A second import of the same file creates nothing and writes no audit line.
		const again = await run(
			'properties',
			'Objekt;Straße;PLZ;Ort;Einheit\nRosenweg 7;Rosenweg 7;10115;Berlin;EG\n'
		);
		expect(again).toMatchObject({ count: 0, skipped: [{ row: 2 }] });
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'))).toHaveLength(1);
	});

	it('creates tenants', async () => {
		const summary = await run('tenants', 'Vorname;Nachname\nLena;Importmann\nJonas;Beispiel\n');
		expect(summary).toMatchObject({ count: 2, created: '2 Mieter angelegt', skipped: [] });
		const rows = await db.select().from(tenants).where(eq(tenants.accountId, 'a'));
		expect(rows.map((tenant) => tenant.lastName).sort()).toEqual(['Beispiel', 'Importmann']);
	});

	it('creates leases, posts the opening balance and generates the charges', async () => {
		const { unitId } = await seedUnit(db, 'a', { name: 'EG links', propertyName: 'Haus' });
		const tenantId = await seedTenant(db, 'a', { firstName: 'Lena', lastName: 'Importmann' });
		const summary = await run(
			'leases',
			[
				'Objekt;Einheit;Mieter;Beginn;Kaltmiete;Nebenkosten;Mietkonto ab;Anfangssaldo',
				'Haus;EG links;Importmann, Lena;01.03.2024;650,00;150,00;01.01.2026;150,00',
				'Haus;EG links;Importmann, Lena;01.03.2024;650,00;150,00;;'
			].join('\n')
		);
		expect(summary).toMatchObject({
			count: 1,
			created: '1 Mietvertrag angelegt',
			skipped: [
				{
					row: 3,
					reason:
						'Der Mietvertrag für „EG links“ in „Haus“ ab 01.03.2024 steht doppelt in der Datei.'
				}
			]
		});
		const [lease] = await db.select().from(leases).where(eq(leases.accountId, 'a'));
		expect(lease).toMatchObject({
			unitId,
			startDate: '2024-03-01',
			baseRent: 65000,
			operatingCostPrepayment: 15000,
			ledgerStart: '2026-01-01'
		});
		expect(await db.select().from(leaseTenants).where(eq(leaseTenants.leaseId, lease.id))).toEqual([
			{ leaseId: lease.id, tenantId }
		]);
		const charges = await db.select().from(rentCharges).where(eq(rentCharges.leaseId, lease.id));
		expect(charges.filter((charge) => charge.kind === 'adjustment')).toMatchObject([
			{ period: '2026-01', dueDate: '2026-01-01', amount: 15000, note: 'Anfangssaldo' }
		]);
		// The rent charges run from the ledger start, not from the start date two years earlier.
		const rents = charges.filter((charge) => charge.kind === 'rent');
		expect(rents.length).toBeGreaterThan(0);
		expect(rents.every((charge) => charge.period >= '2026-01' && charge.amount === 80000)).toBe(
			true
		);
		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Mietvertrag angelegt',
			'CSV-Import: 1 Mietvertrag angelegt, 1 Zeile übersprungen'
		]);
	});

	it('writes all leases with their opening balances in one batch, so a later failure loses none', async () => {
		await seedUnit(db, 'a', { name: 'EG links', propertyName: 'Haus' });
		await seedUnit(db, 'a', { name: 'OG', propertyName: 'Haus 2' });
		await seedTenant(db, 'a', { firstName: 'Lena', lastName: 'Importmann' });
		await seedTenant(db, 'a', { firstName: 'Jonas', lastName: 'Beispiel' });
		const context = await loadImportContext(db, 'a', 'leases');
		const leasePlan = plan(
			'leases',
			[
				'Objekt;Einheit;Mieter;Beginn;Kaltmiete;Mietkonto ab;Anfangssaldo',
				'Haus;EG links;Importmann, Lena;01.03.2024;650,00;01.01.2026;150,00',
				'Haus 2;OG;Beispiel, Jonas;01.05.2024;500,00;01.01.2026;-75,50'
			].join('\n'),
			context
		);
		// The database accepts the first write and fails every later one, as D1 does once the
		// invocation's query limit is reached.
		const sqlite = db as unknown as { transaction(fn: () => void): void };
		const transaction = sqlite.transaction.bind(db);
		let writes = 0;
		sqlite.transaction = (fn) => {
			writes += 1;
			if (writes > 1) throw new Error('D1_ERROR: too many queries');
			transaction(fn);
		};
		await expect(commitImport(db, contextA, leasePlan)).rejects.toThrow('too many queries');

		// Both leases exist and both carry their Anfangssaldo (150,00 € Rückstand, 75,50 €
		// Guthaben) and the import line; only the derived rent charges are missing.
		const created = await db.select().from(leases).where(eq(leases.accountId, 'a'));
		expect(created).toHaveLength(2);
		const charges = await db.select().from(rentCharges).where(eq(rentCharges.accountId, 'a'));
		expect(charges.map((charge) => [charge.leaseId, charge.kind, charge.amount]).sort()).toEqual(
			[
				[created.find((lease) => lease.baseRent === 65000)!.id, 'adjustment', 15000],
				[created.find((lease) => lease.baseRent === 50000)!.id, 'adjustment', -7550]
			].sort()
		);
		const audit = await db.select().from(auditLog).where(eq(auditLog.accountId, 'a'));
		expect(audit.map((entry) => entry.summary)).toEqual([
			'Mietvertrag angelegt',
			'Mietvertrag angelegt',
			'CSV-Import: 2 Mietverträge angelegt'
		]);
	});

	it('refuses rows above the account limit with 409 and writes nothing', async () => {
		const limit = QUOTAS.tenants.max;
		QUOTAS.tenants.max = 1;
		try {
			const refusal = await run(
				'tenants',
				'Vorname;Nachname\nLena;Importmann\nJonas;Beispiel\n'
			).catch((e) => e);
			expect(isHttpError(refusal, 409)).toBe(true);
			expect(refusal.body.message).toContain('höchstens 1 Mieter');
		} finally {
			QUOTAS.tenants.max = limit;
		}
		expect(await db.select().from(tenants)).toEqual([]);
		expect(await db.select().from(auditLog)).toEqual([]);
	});

	it('creates payments on the lease of the unit', async () => {
		const { unitId } = await seedUnit(db, 'a', { name: 'EG links', propertyName: 'Haus' });
		const created = await createLease(db, contextA, leaseInput(unitId));
		if (!created.ok) throw new Error(created.reason);
		const summary = await run(
			'payments',
			'Datum;Objekt;Einheit;Betrag;Verwendungszweck\n03.02.2025;Haus;EG links;800,00;Miete Februar\n03.03.2025;Haus;EG links;800,00;\n03.03.2025;Haus;OG;800,00;\n'
		);
		expect(summary).toMatchObject({
			count: 2,
			created: '2 Zahlungen angelegt',
			skipped: [{ row: 4, reason: 'Die Einheit „OG“ gibt es in „Haus“ nicht.' }]
		});
		const rows = await db.select().from(payments).where(eq(payments.accountId, 'a'));
		expect(rows.map((row) => [row.leaseId, row.date, row.amount, row.source, row.note])).toEqual([
			[created.id, '2025-02-03', 80000, 'manual', 'Miete Februar'],
			[created.id, '2025-03-03', 80000, 'manual', null]
		]);
	});

	it('does not leak into another account', async () => {
		// Account b has a property "Haus" with a unit; account a's import must neither see nor touch it.
		await seedUnit(db, 'b', { name: 'EG links', propertyName: 'Haus' });
		await seedTenant(db, 'b', { firstName: 'Lena', lastName: 'Importmann' });
		const contextOfA = await loadImportContext(db, 'a', 'leases');
		expect(contextOfA).toEqual(emptyImportContext);

		const leasesOfA = await run(
			'leases',
			'Objekt;Einheit;Mieter;Beginn;Kaltmiete\nHaus;EG links;Importmann, Lena;01.01.2025;650,00\n'
		);
		expect(leasesOfA).toMatchObject({
			count: 0,
			skipped: [{ row: 2, reason: 'Das Objekt „Haus“ gibt es nicht.' }]
		});

		await run('properties', 'Objekt;Straße;PLZ;Ort;Einheit\nHaus;Weg 1;10115;Berlin;EG links\n');
		await run('tenants', 'Vorname;Nachname\nLena;Importmann\n');
		expect(await db.select().from(properties).where(eq(properties.accountId, 'b'))).toHaveLength(1);
		expect(await db.select().from(units).where(eq(units.accountId, 'b'))).toHaveLength(1);
		expect(await db.select().from(tenants).where(eq(tenants.accountId, 'b'))).toHaveLength(1);
		expect(await db.select().from(auditLog).where(eq(auditLog.accountId, 'b'))).toHaveLength(0);
		const unitsOfA = await db.select().from(units).where(eq(units.accountId, 'a'));
		expect(unitsOfA).toHaveLength(1);
		const contextOfB = await loadImportContext(db, 'b', 'properties');
		expect(contextOfB.units.map((unit) => unit.id)).not.toContain(unitsOfA[0].id);
	});
});

describe('content encoding', () => {
	it('round-trips UTF-8 text through base64 and refuses tampered content', () => {
		const text = 'Vorname;Nachname\nJürgen;Müller-Lüdenscheidt\n';
		expect(decodeContent(encodeContent(text))).toBe(text);
		expect(decodeContent('not base64!')).toBeUndefined();
		expect(decodeContent('/w==')).toBeUndefined();
	});
});
