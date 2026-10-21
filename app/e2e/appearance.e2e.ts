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
