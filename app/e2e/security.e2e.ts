import { expect, test } from '@playwright/test';
import { seedLease, seedRows } from './seed';

// Every page must work under the Content-Security-Policy from vite.config.ts: a style attribute
// or an inline script without nonce would be blocked in the browser, not in the build.

const pages = [
	'/objekte',
	'/objekte/neu',
	'/mieter',
	'/mieter/neu',
	'/vertraege',
	'/vertraege/neu',
	'/mietkonto',
	'/bank',
	'/bank/konten',
	'/bank/import',
	'/bank/regeln',
	'/dokumente',
	'/betriebskosten/belege',
	'/betriebskosten/belege/neu',
	'/einstellungen',
	'/einstellungen/profil',
	'/einstellungen/vpi'
];

/** Pages below a seeded property: its meters (with a reading) and a cost item. */
async function seededPages(request: Parameters<typeof seedLease>[0]): Promise<string[]> {
	const suffix = crypto.randomUUID().slice(0, 6);
	const { propertyId } = await seedLease(request);
	const {
		ids: [meterId]
	} = await seedRows(request, 'meters', [{ propertyId, kind: 'cold_water', unit: 'm³' }]);
	await seedRows(request, 'meterReadings', [{ meterId, readAt: '2025-01-01', value: 12.5 }]);
	const {
		ids: [categoryId]
	} = await seedRows(request, 'costCategories', [{ name: `Hauswart ${suffix}` }]);
	const {
		ids: [allocationKeyId]
	} = await seedRows(request, 'allocationKeys', [{ name: `Fläche ${suffix}`, kind: 'area' }]);
	const {
		ids: [costItemId]
	} = await seedRows(request, 'costItems', [
		{
			propertyId,
			categoryId,
			allocationKeyId,
			description: 'Hauswart 2025',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31',
			amount: 120000
		}
	]);
	return [`/objekte/${propertyId}/zaehler`, `/betriebskosten/belege/${costItemId}`];
}

test('no page violates the Content-Security-Policy', async ({ page }) => {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
	});
	for (const path of [...pages, ...(await seededPages(page.request))]) {
		// An error page has a heading too, so a seeded page that 404s would pass unchecked.
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(200);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	}
	expect(violations).toEqual([]);
});

test('pages of a signed-in user are not cached', async ({ request }) => {
	const response = await request.get('/objekte');
	expect(response.headers()['cache-control']).toBe('private, no-store');
});
