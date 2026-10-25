import { expect, test } from '@playwright/test';
import { pdfText } from './pdf-text';
import { seedLease, seedRows } from './seed';

// The Steuerübersicht of an Eigentumswohnung: the rent received, the Hausgeld without the
// Zuführung zur Rücklage, the interest from the Zinsbescheinigung and the AfA, by Anlage V line.

test('sorts a year of an Eigentumswohnung into the lines of the Anlage V', async ({ page }) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	const year = new Date().getFullYear() - 1;
	const { propertyId, leaseId } = await seedLease(page.request, {
		property: { kind: 'condominium', ownershipShare: 85, ownershipShareTotal: 1000 },
		unit: { name: `Wohnung 5 ${suffix}`, floorArea: 60 },
		lease: { startDate: `${year}-01-01` }
	});
	const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
	// The seeded lease charges 600 € + 150 € + 50 € a month.
	await seedRows(
		page.request,
		'payments',
		months.map((month) => ({ leaseId, date: `${month}-03`, amount: 80000 }))
	);
	await seedRows(page.request, 'expenses', [
		...months.map((month) => ({
			propertyId,
			date: `${month}-01`,
			amount: 25000,
			category: 'association_fee',
			description: 'Hausgeld'
		})),
		...months.map((month) => ({
			propertyId,
			date: `${month}-15`,
			amount: 50000,
			category: 'loan_payment',
			description: 'Darlehensrate'
		}))
	]);
	await seedRows(page.request, 'associationStatements', [
		{
			propertyId,
			periodStart: `${year}-01-01`,
			periodEnd: `${year}-12-31`,
			allocableCosts: 180000,
			nonAllocableCosts: 60000,
			reserveContribution: 60000,
			reserveWithdrawal: 20000,
			feesDue: 300000
		}
	]);

	await page.goto(`/objekte/${propertyId}/steuer?jahr=${year}`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Sie ist keine Steuerberatung')).toBeVisible();
	await expect(page.getByText(/Ohne Kaufdatum/)).toBeVisible();
	await expect(page.getByText(/Darlehensraten über 6\.000,00\s€/)).toBeVisible();

	const income = page.getByRole('region', { name: 'Einnahmen', exact: true });
	await expect(income.getByRole('row', { name: /^15 Mieteinnahmen für Wohnungen/ })).toContainText(
		'7.200,00 €'
	);
	await expect(income.getByRole('row', { name: /^20 Umlagen/ })).toContainText('2.400,00 €');

	await page.getByLabel('Kaufdatum').fill(`${year - 5}-01-01`);
	await page.getByLabel('Anschaffungskosten in €').fill('250.000,00');
	await page.getByLabel('Gebäudeanteil in %').fill('80');
	await page.getByLabel('AfA-Satz in % im Jahr').fill('2');
	await page.getByRole('button', { name: 'AfA speichern' }).click();
	await page.getByLabel(`Zinsen ${year} laut Zinsbescheinigung in €`).fill('2.100,00');
	await page.getByRole('button', { name: 'Zinsen speichern' }).click();
	await expect(page.getByText(/Darlehensraten über/)).toHaveCount(0);

	const costs = page.getByRole('region', { name: 'Werbungskosten', exact: true });
	await expect(costs.getByRole('row', { name: /^33 AfA Gebäude/ })).toContainText('4.000,00 €');
	await expect(costs.getByRole('row', { name: /^46 Schuldzinsen/ })).toContainText('2.100,00 €');
	// 3.000 € Hausgeld less 600 € Zuführung, three quarters allocable; the Entnahme is Erhaltung.
	await expect(costs.getByRole('row', { name: /^73 Umgelegte Kosten/ })).toContainText(
		'1.800,00 €'
	);
	await expect(costs.getByRole('row', { name: /^76 Nicht umgelegte Kosten/ })).toContainText(
		'600,00 €'
	);
	await expect(costs.getByRole('row', { name: /^55 Erhaltungsaufwendungen/ })).toContainText(
		'200,00 €'
	);
	await expect(page.getByText('Tilgung in den Darlehensraten')).toBeVisible();

	const pdf = await page.request.get(`/objekte/${propertyId}/steuer/pdf?jahr=${year}`);
	expect(pdf.headers()['content-type']).toBe('application/pdf');
	const text = await pdfText(await pdf.body());
	expect(text).toContain(`Steuerübersicht ${year}`);
	expect(text).toContain('keine Steuerberatung');

	const csv = await page.request.get(`/objekte/${propertyId}/steuer/csv?jahr=${year}`);
	expect(await csv.text()).toContain(
		'Werbungskosten;46;Schuldzinsen;Zinsen laut Zinsbescheinigung;2.100,00'
	);
});
