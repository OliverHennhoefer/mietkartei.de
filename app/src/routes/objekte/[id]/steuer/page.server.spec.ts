import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { getProperty } from '#lib/server/properties.ts';
import { outcome, routeEvent, seedUnit, testDatabase } from '#lib/server/testing.ts';
import { GET as csv } from './csv/+server';
import { GET as pdf } from './pdf/+server';
import { actions, load } from './+page.server';
import { taxYearOf } from './year';

let db: Database;
let propertyId: string;

beforeEach(async () => {
	db = await testDatabase();
	({ propertyId } = await seedUnit(db, 'a'));
});

async function run(handler: (event: never) => unknown, options: Parameters<typeof routeEvent>[1]) {
	const property = await getProperty(db, 'a', propertyId);
	return outcome(() => handler(routeEvent(db, { parent: { property }, ...options })));
}

const basis = {
	year: '2025',
	acquisitionDate: '2020-01-01',
	acquisitionCost: '300.000,00',
	buildingShare: '80',
	depreciationRate: '2'
};

describe('objekte/[id]/steuer', () => {
	it('shows the year asked for, by default the last one', async () => {
		expect(await run(load, { params: { id: propertyId }, url: '/?jahr=2024' })).toMatchObject({
			data: { year: 2024, tax: { incomeTotal: 0 } }
		});
		expect(taxYearOf(null, '2026-10-24')).toBe(2025);
		expect(taxYearOf('2027', '2026-10-24')).toBe(2025);
		expect(taxYearOf('1800', '2026-10-24')).toBe(2025);
		expect(taxYearOf('2026', '2026-10-24')).toBe(2026);
	});

	it('saves the AfA basis and shows the AfA of the year', async () => {
		const params = { id: propertyId };
		expect(await run(actions.depreciation, { params, form: basis })).toEqual({
			redirect: `/objekte/${propertyId}/steuer?jahr=2025`
		});
		expect(await run(load, { params, url: '/?jahr=2025' })).toMatchObject({
			data: { tax: { depreciation: { base: 240_000_00, amount: 4_800_00 } } }
		});
		expect(
			await run(actions.depreciation, { params, form: { ...basis, buildingShare: '' } })
		).toMatchObject({
			fail: 400,
			data: { form: 'depreciation', errors: { buildingShare: expect.any(String) } }
		});
		expect(await run(actions.depreciation, { params: { id: 'fremd' }, form: basis })).toMatchObject(
			{
				error: 404
			}
		);
	});

	it('saves the interest of a year', async () => {
		const params = { id: propertyId };
		expect(
			await run(actions.interest, { params, form: { year: '2024', loanInterest: '1.000,00' } })
		).toEqual({ redirect: `/objekte/${propertyId}/steuer?jahr=2024` });
		expect(await run(load, { params, url: '/?jahr=2024' })).toMatchObject({
			data: { tax: { loanInterest: 1_000_00 } }
		});
		expect(await run(actions.interest, { params, form: { year: 'x' } })).toMatchObject({
			fail: 400,
			data: { form: 'interest' }
		});
		expect(
			await run(actions.interest, { params: { id: 'fremd' }, form: { year: '2024' } })
		).toMatchObject({ error: 404 });
	});

	it('downloads the overview as CSV and PDF', async () => {
		const params = { id: propertyId };
		const csvOutcome = await run(csv, { params, url: '/?jahr=2025' });
		const csvResponse = (csvOutcome as { data: Response }).data;
		expect(csvResponse.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(await csvResponse.text()).toContain('Steuerübersicht 2025');
		const pdfOutcome = await run(pdf, { params, url: '/?jahr=2025' });
		const pdfResponse = (pdfOutcome as { data: Response }).data;
		expect(pdfResponse.headers.get('content-type')).toBe('application/pdf');
		expect(await run(csv, { params: { id: 'fremd' } })).toMatchObject({ error: 404 });
		expect(await run(pdf, { params: { id: 'fremd' } })).toMatchObject({ error: 404 });
	});
});
