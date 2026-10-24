import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createAssociationStatement } from './association-statements';
import type { Database } from './db';
import { auditLog, expenses, taxYears, type ExpenseCategory } from './db/schema';
import { createPayment } from './ledger';
import { renderReport } from './pdf';
import { getProperty } from './properties';
import {
	csvResponse,
	loadTaxOverview,
	saveDepreciation,
	saveLoanInterest,
	taxCsv,
	taxFilename,
	taxReport
} from './tax';
import { contextA, contextB, seedLease, seedTenant, seedUnit, testDatabase } from './testing';

let db: Database;
let propertyId: string;
let unitId: string;
let leaseId: string;

async function expense(date: string, amount: number, category: ExpenseCategory, scope = {}) {
	await db.insert(expenses).values({
		accountId: 'a',
		propertyId,
		date,
		amount,
		category,
		description: category,
		...scope
	});
}

async function property() {
	return (await getProperty(db, 'a', propertyId))!;
}

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId, unitId } = await seedUnit(db, 'a'));
	const tenantId = await seedTenant(db, 'a');
	leaseId = await seedLease(db, 'a', unitId, { tenantIds: [tenantId] });
	for (let month = 1; month <= 12; month++) {
		await createPayment(db, contextA, {
			leaseId,
			date: `2025-${String(month).padStart(2, '0')}-03`,
			amount: 800_00,
			source: 'manual'
		});
	}
});

describe('loadTaxOverview', () => {
	it('adds up the payments, expenses and Hausgeld of the property for the year', async () => {
		await expense('2025-03-01', 1_000_00, 'maintenance');
		// Booked on the unit only, as the bank assignment does for a unit.
		await expense('2025-04-01', 200_00, 'management', { propertyId: null, unitId });
		await expense('2025-05-01', 3_000_00, 'association_fee');
		await expense('2025-06-01', 4_000_00, 'loan_payment');
		await expense('2024-06-01', 9_999_00, 'maintenance');
		await createAssociationStatement(db, contextA, propertyId, {
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			allocableCosts: 1_800_00,
			nonAllocableCosts: 600_00,
			reserveContribution: 600_00,
			reserveWithdrawal: 100_00,
			feesDue: 3_000_00,
			statedBalance: null,
			note: null
		});
		await saveLoanInterest(db, contextA, propertyId, 2025, 1_500_00);
		await saveDepreciation(db, contextA, propertyId, {
			acquisitionDate: '2024-07-01',
			acquisitionCost: 200_000_00,
			buildingShare: 80,
			depreciationRate: 2
		});

		const page = await loadTaxOverview(db, 'a', await property(), 2025);
		expect(page.incomeTotal).toBe(9_600_00);
		expect(page.leases).toMatchObject([
			{ leaseId, label: 'EG links · Erika Mustermann', baseRent: 7_200_00, prorated: false }
		]);
		const amounts = Object.fromEntries(page.costs.map((line) => [line.key, line.amount]));
		expect(amounts).toEqual({
			depreciation: 3_200_00,
			interest: 1_500_00,
			maintenance: 1_100_00,
			allocatedCosts: 1_800_00,
			unallocatedCosts: 800_00
		});
		expect(page.loanInterest).toBe(1_500_00);
		expect(page.years).toEqual([2026, 2025, 2024]);
	});

	it('shows nothing of another account', async () => {
		const other = await seedUnit(db, 'b');
		await db.insert(expenses).values({
			accountId: 'b',
			propertyId: other.propertyId,
			date: '2025-01-01',
			amount: 100_00,
			category: 'other',
			description: 'fremd'
		});
		const page = await loadTaxOverview(
			db,
			'b',
			(await getProperty(db, 'b', other.propertyId))!,
			2025
		);
		expect(page.leases).toEqual([]);
		expect(page.incomeTotal).toBe(0);
		expect(page.costs.map((line) => line.key)).toEqual(['otherCosts']);
	});
});

describe('saveDepreciation and saveLoanInterest', () => {
	it('stores the AfA basis with an audit line, only in the own account', async () => {
		const basis = {
			acquisitionDate: '2020-01-01',
			acquisitionCost: 100_000_00,
			buildingShare: 70,
			depreciationRate: 2
		};
		expect(await saveDepreciation(db, contextA, propertyId, basis)).toBe(true);
		expect(await property()).toMatchObject(basis);
		expect(await saveDepreciation(db, contextB, propertyId, basis)).toBe(false);
		const audit = await db.select().from(auditLog);
		expect(audit.map((row) => row.summary)).toContain('Angaben zur AfA für Objekt Haus geändert');
	});

	it('creates, changes and clears the interest of a year', async () => {
		expect(await saveLoanInterest(db, contextA, propertyId, 2025, 1_000_00)).toBe(true);
		expect(await saveLoanInterest(db, contextA, propertyId, 2025, 1_200_00)).toBe(true);
		expect(await db.select().from(taxYears)).toMatchObject([
			{ year: 2025, loanInterest: 1_200_00 }
		]);
		await saveLoanInterest(db, contextA, propertyId, 2025, null);
		expect(await db.select().from(taxYears)).toMatchObject([{ loanInterest: null }]);
		expect(await saveLoanInterest(db, contextB, propertyId, 2025, 1_00)).toBe(false);
	});
});

describe('exports', () => {
	it('writes the lines as CSV with semicolons and decimal commas', async () => {
		await expense('2025-06-01', 4_000_00, 'loan_payment');
		const page = await loadTaxOverview(db, 'a', await property(), 2025);
		const csv = taxCsv(await property(), page);
		expect(csv.startsWith('﻿Steuerübersicht 2025;')).toBe(true);
		expect(csv).toContain(
			'Einnahmen;15;Mieteinnahmen für Wohnungen (ohne Umlagen);Kaltmiete Wohnungen;7.200,00'
		);
		expect(csv).toContain('Einnahmen;32;Summe der Einnahmen;;9.600,00');
		expect(csv).toContain('Ergebnis;85;Überschuss;;9.600,00');
		expect(csv).toContain('Nicht abziehbar;;Darlehensraten;');
		expect(csv).toContain('\r\nDiese Übersicht ist eine Hilfe');
		const quoted = taxCsv({ ...(await property()), name: 'Haus; "Nord"' }, page);
		expect(quoted).toContain('2025;"Haus; ""Nord"", Lindenstraße 4');

		const response = csvResponse(csv, taxFilename({ name: 'Haus Ö' }, 2025, 'csv'));
		expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(response.headers.get('content-disposition')).toContain(
			'filename="Anlage V Haus _ 2025.csv"'
		);
	});

	it('builds a report with the AfA, the leases and the findings', async () => {
		await saveDepreciation(db, contextA, propertyId, {
			acquisitionDate: '2024-07-01',
			acquisitionCost: 200_000_00,
			buildingShare: 80,
			depreciationRate: 2
		});
		await expense('2025-06-01', 4_000_00, 'loan_payment');
		await createPayment(db, contextA, {
			leaseId,
			date: '2025-12-20',
			amount: 50_00,
			source: 'manual'
		});
		const page = await loadTaxOverview(db, 'a', await property(), 2025);
		const report = await taxReport(db, 'a', await property(), page);
		expect(report.title).toBe('Steuerübersicht 2025: Haus');
		const paragraphs = report.blocks.flatMap((block) =>
			'paragraph' in block ? [block.paragraph] : []
		);
		expect(paragraphs.some((text) => text.startsWith('AfA: Anschaffung am 01.07.2024'))).toBe(true);
		expect(paragraphs.some((text) => text.startsWith('Hinweis:'))).toBe(true);
		expect(paragraphs.some((text) => text.startsWith('* Zahlungen'))).toBe(true);
		const titles = report.blocks.flatMap((block) => ('table' in block ? [block.table.title] : []));
		expect(titles).toEqual([
			'Einnahmen',
			'Werbungskosten',
			'Einnahmen je Mietvertrag',
			'Gebucht, aber nicht sofort abziehbar'
		]);
		const doc = await PDFDocument.load(await renderReport(report));
		expect(doc.getPageCount()).toBeGreaterThan(0);
	});
});
