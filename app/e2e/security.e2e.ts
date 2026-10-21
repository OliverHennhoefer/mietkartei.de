import { expect, test, type Page } from '@playwright/test';
import { seedLease, seedRows } from './seed';

// Every page must work under the Content-Security-Policy from vite.config.ts: a style attribute
// or an inline script without nonce would be blocked in the browser, not in the build. A new
// page goes into this list.

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
	'/betriebskosten',
	'/betriebskosten/kostenarten',
	'/betriebskosten/schluessel',
	'/dokumente',
	'/einstellungen',
	'/einstellungen/profil',
	'/einstellungen/vpi'
];

/** Collects the CSP violations the browser reports on the console. */
function watchViolations(page: Page): string[] {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
	});
	return violations;
}

async function visit(page: Page, path: string) {
	await page.goto(path);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The first link of a list page that leads to one of its entries. */
async function firstEntry(page: Page, listPath: string): Promise<string> {
	await page.goto(listPath);
	const href = await page.locator(`main a[href^="${listPath}/"]`).first().getAttribute('href');
	if (!href) throw new Error(`no entry on ${listPath}`);
	return href;
}

test('no page violates the Content-Security-Policy', async ({ page }) => {
	const violations = watchViolations(page);
	for (const path of pages) await visit(page, path);
	expect(violations).toEqual([]);
});

test('no detail page violates the Content-Security-Policy', async ({ page }) => {
	const { propertyId, unitId, tenantId, leaseId } = await seedLease(page.request);
	const {
		ids: [circleId]
	} = await seedRows(page.request, 'billingCircles', [{ propertyId, name: 'CSP-Kreis' }]);
	const violations = watchViolations(page);
	const property = `/objekte/${propertyId}`;
	const lease = `/vertraege/${leaseId}`;
	const detailPages = [
		property,
		`${property}/bearbeiten`,
		`${property}/einheiten/${unitId}`,
		`${property}/einheiten/${unitId}/bearbeiten`,
		`${property}/abrechnungskreise`,
		`${property}/abrechnungskreise/${circleId}`,
		`/mieter/${tenantId}`,
		`/mieter/${tenantId}/bearbeiten`,
		lease,
		`${lease}/bearbeiten`,
		`${lease}/dokumente`,
		`${lease}/kaution`,
		`${lease}/miethoehe`,
		`${lease}/mietkonto`,
		// The standard categories and keys are seeded on the first visit of the list.
		await firstEntry(page, '/betriebskosten/kostenarten'),
		await firstEntry(page, '/betriebskosten/schluessel')
	];
	for (const path of detailPages) await visit(page, path);
	expect(violations).toEqual([]);
});

test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('the sign-in and registration pages keep to the Content-Security-Policy', async ({
		page
	}) => {
		const violations = watchViolations(page);
		for (const path of ['/anmelden', '/registrieren']) await visit(page, path);
		expect(violations).toEqual([]);
	});
});

test('pages of a signed-in user are not cached', async ({ request }) => {
	const response = await request.get('/objekte');
	expect(response.headers()['cache-control']).toBe('private, no-store');
});
