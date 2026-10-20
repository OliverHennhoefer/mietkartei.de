import { expect, test } from '@playwright/test';
import { owner } from './owner';

test('the first visitor registers and becomes the owner', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/registrieren$/);

	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto anlegen' }).click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation')).toContainText(owner.email);
	await page.context().storageState({ path: '.e2e/owner.json' });
});
