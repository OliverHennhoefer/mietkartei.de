import { expect, test, type Page } from '@playwright/test';
import { watchCspViolations } from './csp';
import { seedLease, seedRows, seedUser } from './seed';

/** A link token and the SHA-256 the database keeps of it, for seeding invitations and resets. */
async function linkToken() {
	const token = crypto.randomUUID();
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
	return { token, hash: hash.join('') };
}

// Every page must work under the Content-Security-Policy from vite.config.ts: a style attribute
// or an inline script without nonce would be blocked in the browser, not in the build. A new
// page goes into this list.

const pages = [
	'/',
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
	'/aufgaben',
	'/betriebskosten',
	'/betriebskosten/kostenarten',
	'/betriebskosten/schluessel',
	'/betriebskosten/belege',
	'/betriebskosten/belege/neu',
	'/dokumente',
	'/einstellungen',
	'/einstellungen/profil',
	'/einstellungen/zugaenge',
	'/einstellungen/protokoll',
	'/einstellungen/vpi',
	'/datenuebernahme',
	'/einstellungen/export',
	'/einstellungen/konto',
	'/abo'
];

async function visit(page: Page, path: string) {
	// An error page has a heading too, so a seeded page that 404s would pass unchecked.
	const response = await page.goto(path);
	expect(response?.status(), path).toBe(200);
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
	const violations = watchCspViolations(page);
	for (const path of pages) await visit(page, path);
	expect(violations).toEqual([]);
});

test('no detail page violates the Content-Security-Policy', async ({ page }) => {
	const { propertyId, unitId, tenantId, leaseId } = await seedLease(page.request);
	const {
		ids: [circleId]
	} = await seedRows(page.request, 'billingCircles', [{ propertyId, name: 'CSP-Kreis' }]);
	const {
		ids: [meterId]
	} = await seedRows(page.request, 'meters', [{ propertyId, kind: 'cold_water', unit: 'm³' }]);
	await seedRows(page.request, 'meterReadings', [{ meterId, readAt: '2025-01-01', value: 12.5 }]);
	const suffix = crypto.randomUUID().slice(0, 6);
	const {
		ids: [categoryId]
	} = await seedRows(page.request, 'costCategories', [{ name: `Hauswart ${suffix}` }]);
	const {
		ids: [allocationKeyId]
	} = await seedRows(page.request, 'allocationKeys', [{ name: `Fläche ${suffix}`, kind: 'area' }]);
	const {
		ids: [costItemId]
	} = await seedRows(page.request, 'costItems', [
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
	const {
		ids: [statementId]
	} = await seedRows(page.request, 'operatingCostStatements', [
		{ propertyId, periodStart: '2025-01-01', periodEnd: '2025-12-31' }
	]);
	const {
		ids: [taskId]
	} = await seedRows(page.request, 'tasks', [{ title: `Aufgabe ${suffix}`, leaseId }]);
	// The invitation, reset and address confirmation pages open from a mail; their links are
	// seeded here.
	const expiresAt = Date.now() + 60 * 60 * 1000;
	const invitation = await linkToken();
	await seedRows(page.request, 'invitations', [
		{ email: `csp-${suffix}@example.org`, tokenHash: invitation.hash, expiresAt }
	]);
	const reset = await linkToken();
	const { id: userId } = await seedUser(page.request, {
		email: `csp-reset-${suffix}@example.org`,
		password: 'ein-sicheres-passwort',
		role: 'manager'
	});
	await seedRows(page.request, 'passwordResets', [{ id: reset.hash, userId, expiresAt }]);
	const emailChange = await linkToken();
	await seedRows(page.request, 'emailChanges', [
		{ id: emailChange.hash, userId, email: `csp-neu-${suffix}@example.org`, expiresAt }
	]);
	const violations = watchCspViolations(page);
	const property = `/objekte/${propertyId}`;
	const lease = `/vertraege/${leaseId}`;
	const detailPages = [
		property,
		`${property}/bearbeiten`,
		`${property}/einheiten/${unitId}`,
		`${property}/einheiten/${unitId}/bearbeiten`,
		`${property}/abrechnungskreise`,
		`${property}/abrechnungskreise/${circleId}`,
		`${property}/zaehler`,
		`/mieter/${tenantId}`,
		`/mieter/${tenantId}/bearbeiten`,
		lease,
		`${lease}/bearbeiten`,
		`${lease}/co2`,
		`${lease}/dokumente`,
		`${lease}/kaution`,
		`${lease}/miethoehe`,
		`${lease}/mietkonto`,
		// The standard categories and keys are seeded on the first visit of the list.
		`/betriebskosten/belege/${costItemId}`,
		`/betriebskosten/abrechnungen/${statementId}`,
		`/aufgaben/${taskId}`,
		`/einladung/${invitation.token}`,
		`/passwort-zuruecksetzen/${reset.token}`,
		`/e-mail-bestaetigen/${emailChange.token}`,
		await firstEntry(page, '/betriebskosten/kostenarten'),
		await firstEntry(page, '/betriebskosten/schluessel')
	];
	for (const path of detailPages) await visit(page, path);
	expect(violations).toEqual([]);
});

test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	// Registration is closed by now; setup.e2e.ts checks the open registration form.
	test('the sign-in, registration and reset pages keep to the Content-Security-Policy', async ({
		page
	}) => {
		const violations = watchCspViolations(page);
		for (const path of ['/anmelden', '/registrieren', '/passwort-vergessen']) {
			await visit(page, path);
		}
		expect(violations).toEqual([]);
	});
});

test('pages of a signed-in user are not cached', async ({ request }) => {
	const response = await request.get('/objekte');
	expect(response.headers()['cache-control']).toBe('private, no-store');
});
