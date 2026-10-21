import { expect, test } from '@playwright/test';
import { watchCspViolations } from './csp';
import { owner } from './owner';

test('the first visitor registers and becomes the owner', async ({ page }) => {
	// The only run of the open registration form, so it is also checked against the CSP.
	const violations = watchCspViolations(page);
	await page.goto('/');
	await expect(page).toHaveURL(/\/registrieren$/);

	await page.getByLabel('E-Mail-Adresse').fill(owner.email);
	await page.getByLabel('Passwort').fill(owner.password);
	await page.getByRole('button', { name: 'Konto anlegen' }).click();

	await expect(page).toHaveURL(/\/objekte$/);
	await expect(page.getByRole('navigation')).toContainText(owner.email);
	await page.context().storageState({ path: '.e2e/owner.json' });
	expect(violations).toEqual([]);
});
