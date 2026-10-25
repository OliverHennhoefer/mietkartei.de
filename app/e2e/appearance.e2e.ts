import { expect, test } from '@playwright/test';
import { seedLease } from './seed';

test('finds properties by name and address and recovers from an empty search', async ({ page }) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	const name = `Suchhaus ${suffix}`;
	await seedLease(page.request, {
		property: { name, street: `Suchweg ${suffix}`, city: 'Bremen' }
	});
	await page.goto('/objekte');
	const search = page.getByRole('searchbox', { name: 'Objekte durchsuchen' });
	const properties = page.getByRole('list', { name: 'Objekte' });

	await search.fill(`  SUCHHAUS ${suffix}  `);
	await expect(properties.getByRole('listitem')).toHaveCount(1);
	await expect(properties).toContainText(name);
	await search.fill(`suchweg ${suffix}`);
	await expect(properties.getByRole('listitem')).toHaveCount(1);
	await expect(properties).toContainText('Bremen');
	await search.fill(`nicht-vorhanden-${suffix}`);
	await expect(page.getByText('Keine passenden Objekte', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
	await expect(search).toHaveValue('');
	await expect(properties).toContainText(name);
});

test('opens and closes mobile navigation and restores the workspace after resizing', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/objekte');
	const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
	const toggle = page.locator('.nav-toggle');
	const main = page.getByRole('main');
	await expect(nav).toBeHidden();
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(nav).toBeVisible();
	await expect(main).toHaveAttribute('inert');
	await page.keyboard.press('Escape');
	await expect(toggle).toBeFocused();
	await expect(nav).toBeHidden();
	await expect(main).not.toHaveAttribute('inert');

	await toggle.click();
	await page.mouse.click(370, 100);
	await expect(nav).toBeHidden();
	await expect(toggle).toBeFocused();
	await expect(main).not.toHaveAttribute('inert');

	await toggle.click();
	await nav.getByRole('link', { name: 'Mieter', exact: true }).click();
	await expect(page).toHaveURL(/\/mieter$/);
	await expect(nav).toBeHidden();
	await expect(main).not.toHaveAttribute('inert');
	await toggle.click();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(main).not.toHaveAttribute('inert');
	await expect(nav.getByRole('link', { name: 'Mieter', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(main.getByRole('heading', { name: 'Mieter', exact: true })).toBeVisible();
});

test('gives focus back to the menu button when the settings close on a phone', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/mieter');
	await page.waitForLoadState('networkidle');
	const toggle = page.locator('.nav-toggle');
	await toggle.click();
	await page.getByRole('button', { name: 'Konto' }).click();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(toggle).toBeFocused();
});

test('opens the settings as a dialog over the page and closes it again', async ({ page }) => {
	await page.goto('/mieter');
	await expect(page).toHaveTitle('Mieter | mietkartei');
	const account = page.getByRole('button', { name: 'Konto' });
	await account.click();
	// The menu opens above the account card but follows it for the keyboard.
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Einstellungen' })).toBeFocused();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
	await expect(dialog.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/profil$/);
	await expect(page).toHaveTitle('Profil | mietkartei');

	// The sections switch inside the dialog; one step back closes it.
	await dialog.getByRole('link', { name: 'Protokoll' }).click();
	await expect(dialog.getByRole('heading', { level: 1, name: 'Protokoll' })).toBeVisible();
	await expect(page).toHaveURL(/\/einstellungen\/protokoll$/);
	await page.goBack();
	await expect(dialog).toHaveCount(0);
	await expect(page).toHaveURL(/\/mieter$/);
	await expect(page).toHaveTitle('Mieter | mietkartei');

	// Escape closes it too, and focus returns to the account button.
	await account.click();
	await page.getByRole('link', { name: 'Einstellungen' }).click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(account).toBeFocused();

	// Opened by its address, the section is the same dialog; closing leads to the overview.
	await page.goto('/einstellungen/vpi');
	await expect(
		dialog.getByRole('heading', { level: 1, name: 'Verbraucherpreisindex' })
	).toBeVisible();
	// The close button works only once the page is hydrated.
	await page.waitForLoadState('networkidle');
	await dialog.getByRole('button', { name: 'Einstellungen schließen' }).click();
	await expect(page).toHaveURL(/\/$/);
});

test('stacks table rows with their column headings on a phone, without sideways scrolling', async ({
	page
}) => {
	const suffix = crypto.randomUUID().slice(0, 8);
	await seedLease(page.request, { tenant: { lastName: `Handy-${suffix}` } });
	await page.setViewportSize({ width: 375, height: 812 });
	for (const path of ['/mietkonto', '/vertraege', '/bank/konten', '/auswertung/ausgaben']) {
		await page.goto(path);
		const width = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(width, path).toBeLessThanOrEqual(375);
	}

	await page.goto('/mietkonto');
	const row = page.getByRole('row').filter({ hasText: `Handy-${suffix}` });
	await expect(row.getByRole('cell').nth(1)).toHaveAttribute('data-label', 'Mieter');
	await expect(row.getByRole('cell').nth(2)).toHaveAttribute('data-label', 'Saldo');
	// The saldo stands below the tenant, not in a column beside it.
	const tenant = await row.getByRole('cell').nth(1).boundingBox();
	const balance = await row.getByRole('cell').nth(2).boundingBox();
	expect(balance!.y).toBeGreaterThan(tenant!.y);
	expect(balance!.x + balance!.width).toBeLessThanOrEqual(375);
});
