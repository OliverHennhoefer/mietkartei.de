import { expect, test } from '@playwright/test';
import { pdfText } from './pdf-text';
import { seedLease, seedRows } from './seed';

// The landlord sender block under /einstellungen/profil, which every letter prints.

test('saves the landlord sender block, which the letters print', async ({ page }) => {
	// Reached through the settings in the main navigation.
	await page.goto('/objekte');
	await page.getByRole('navigation').getByRole('link', { name: 'Einstellungen' }).click();
	await page
		.getByRole('list', { name: 'Einstellungen' })
		.getByRole('link', { name: 'Profil' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
	const form = page.locator('form[action="?/landlord"]');

	// An invalid postal code is refused in place, with the values kept.
	await form.getByLabel('Name des Vermieters').fill('Vera Vermieterin');
	await form.getByLabel('Straße und Hausnummer').fill('Lindenstraße 4');
	await form.getByLabel('Postleitzahl').fill('1234');
	await form.getByLabel('Ort').fill('Leipzig');
	await form.getByRole('button', { name: 'Absender speichern' }).click();
	await expect(form.getByText('Die Postleitzahl hat fünf Ziffern.')).toBeVisible();
	await expect(form.getByLabel('Straße und Hausnummer')).toHaveValue('Lindenstraße 4');

	await form.getByLabel('Postleitzahl').fill('04109');
	await form.getByRole('button', { name: 'Absender speichern' }).click();
	await expect(page.getByText('Der Absender wurde gespeichert.')).toBeVisible();

	// Stored: the form shows it after a reload.
	await page.reload();
	await expect(form.getByLabel('Name des Vermieters')).toHaveValue('Vera Vermieterin');
	await expect(form.getByLabel('Postleitzahl')).toHaveValue('04109');
	await expect(form.getByLabel('Ort')).toHaveValue('Leipzig');

	// An index rent letter (seeded, the rent feature writes it) prints the block as sender and
	// the place in the date line.
	const lease = await seedLease(page.request);
	const {
		ids: [changeId]
	} = await seedRows(page.request, 'rentChanges', [
		{
			leaseId: lease.leaseId,
			validFrom: '2026-03-01',
			baseRent: 62_000,
			reason: 'indexed',
			status: 'approved',
			deliveredOn: '2026-01-10',
			letterText: 'Sehr geehrte Frau Muster,\n\ndie Kaltmiete steigt nach dem Index.'
		}
	]);
	const response = await page.request.get(
		`/vertraege/${lease.leaseId}/miethoehe/brief/${changeId}`
	);
	expect(response.status()).toBe(200);
	const text = await pdfText(await response.body());
	for (const line of ['Vera Vermieterin', 'Lindenstraße 4', '04109 Leipzig']) {
		expect(text).toContain(line);
	}
	expect(text).toContain('Leipzig, 10.01.2026');
});
