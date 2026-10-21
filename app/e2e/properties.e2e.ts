import { expect, test, type Page } from '@playwright/test';
import { seedLease } from './seed';

// Names carry a random suffix, so the tests can find their own rows in a shared database.
const suffix = () => crypto.randomUUID().slice(0, 6);

/** Accepts the next confirm() dialog, as ConfirmButton asks before a delete. */
function acceptNextDialog(page: Page) {
	page.once('dialog', (dialog) => void dialog.accept());
}

test('creates a property and adds units to it', async ({ page }) => {
	const name = `Mehrfamilienhaus Lindenstraße ${suffix()}`;
	await page.goto('/objekte');
	await expect(page.getByRole('heading', { level: 1, name: 'Objekte' })).toBeVisible();
	await page.getByRole('link', { name: 'Objekt anlegen' }).first().click();
	await expect(page).toHaveURL(/\/objekte\/neu$/);

	await page.getByLabel('Bezeichnung').fill(name);
	await page.getByLabel('Straße und Hausnummer').fill('Lindenstraße 4');
	await page.getByLabel('Postleitzahl').fill('10115');
	await page.getByLabel('Ort').fill('Berlin');
	await page.getByLabel('Gebäudeart').selectOption({ label: 'Wohngebäude' });
	await page.getByLabel('Personen bei Leerstand').fill('1');
	await page.getByRole('button', { name: 'Objekt anlegen' }).click();

	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
	await expect(page.getByText('Dieses Objekt hat noch keine Einheiten.')).toBeVisible();

	await page.getByLabel('Bezeichnung').fill('Wohnung EG links');
	await page.getByLabel('Art').selectOption({ label: 'Wohnung' });
	await page.getByLabel('Fläche in m² (optional)').fill('72,5');
	await page.getByLabel('Etage (optional)').fill('EG');
	await page.getByLabel('Zimmer (optional)').fill('3');
	await page.getByRole('button', { name: 'Einheit anlegen' }).click();

	const units = page.getByRole('list', { name: 'Einheiten' });
	await expect(units.getByRole('listitem')).toHaveCount(1);
	await expect(units).toContainText('Wohnung EG links');
	await expect(units).toContainText('72,5 m²');
	await expect(units).toContainText('EG');
	await expect(units).toContainText('3 Zimmer');
	// Without a lease the unit is vacant and offers to create one.
	await expect(units).toContainText('Leerstand');
	await expect(units.getByRole('link', { name: 'Mietvertrag anlegen' })).toHaveAttribute(
		'href',
		/^\/vertraege\/neu\?unitId=/
	);

	await page.getByRole('link', { name: '← Alle Objekte' }).click();
	const list = page.getByRole('list', { name: 'Objekte' });
	await expect(list).toContainText(name);
	await expect(list.getByRole('listitem').filter({ hasText: name })).toContainText(
		'1 Einheit · 0 laufende Mietverträge · Leerstand: 1 Einheit'
	);
});

test('shows validation errors next to the fields', async ({ page }) => {
	await page.goto('/objekte/neu');
	await page.getByLabel('Bezeichnung').fill('Haus ohne Postleitzahl');
	await page.getByLabel('Straße und Hausnummer').fill('Am Markt 1');
	await page.getByLabel('Postleitzahl').fill('123');
	await page.getByLabel('Ort').fill('Leipzig');
	await page.getByRole('button', { name: 'Objekt anlegen' }).click();

	await expect(page.getByText('Die Postleitzahl hat fünf Ziffern.')).toBeVisible();
	await expect(page.getByLabel('Bezeichnung')).toHaveValue('Haus ohne Postleitzahl');
});

test('answers unknown properties and units with 404', async ({ page }) => {
	const response = await page.goto('/objekte/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');

	const { propertyId } = await seedLease(page.request);
	const unit = await page.goto(`/objekte/${propertyId}/einheiten/does-not-exist`);
	expect(unit?.status()).toBe(404);
});

test('edits a property and shows its occupancy in the list', async ({ page }) => {
	const name = `Testhaus ${suffix()}`;
	const { propertyId } = await seedLease(page.request, { property: { name } });

	await page.goto('/objekte');
	await expect(
		page.getByRole('list', { name: 'Objekte' }).getByRole('listitem').filter({ hasText: name })
	).toContainText('1 Einheit · 1 laufender Mietvertrag · kein Leerstand');

	await page.goto(`/objekte/${propertyId}`);
	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/bearbeiten$`));
	await expect(page.getByLabel('Bezeichnung')).toHaveValue(name);
	await page.getByLabel('Bezeichnung').fill(`${name} (saniert)`);
	await page.getByLabel('Ort').fill('Potsdam');
	await page.getByLabel('Gebäudeart').selectOption({ label: 'Nichtwohngebäude' });
	await page.getByLabel('Personen bei Leerstand').fill('2');
	await page.getByLabel('Notizen').fill('Dach 2024 erneuert');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${name} (saniert)`);
	await expect(page.getByText('Lindenstraße 4, 10115 Potsdam')).toBeVisible();
	// The edit form shows the saved values again.
	await page.goto(`/objekte/${propertyId}/bearbeiten`);
	await expect(page.getByLabel('Gebäudeart')).toHaveValue('non_residential');
	await expect(page.getByLabel('Personen bei Leerstand')).toHaveValue('2');
	await expect(page.getByLabel('Notizen')).toHaveValue('Dach 2024 erneuert');
});

test('opens a unit, shows its lease and edits the unit', async ({ page }) => {
	const unitName = `Wohnung ${suffix()}`;
	const { propertyId, unitId, leaseId } = await seedLease(page.request, {
		unit: { name: unitName },
		tenant: { firstName: 'Erika', lastName: 'Musterfrau' }
	});

	await page.goto(`/objekte/${propertyId}`);
	const units = page.getByRole('list', { name: 'Einheiten' });
	await expect(units.getByRole('link', { name: 'Erika Musterfrau' })).toHaveAttribute(
		'href',
		`/vertraege/${leaseId}`
	);
	await units.getByRole('link', { name: unitName }).click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/einheiten/${unitId}$`));
	await expect(page.getByRole('heading', { level: 2, name: `Einheit ${unitName}` })).toBeVisible();
	await expect(page.getByText('Vermietet', { exact: true })).toBeVisible();
	const leases = page.getByRole('table', { name: 'Mietverträge' });
	await expect(leases).toContainText('Erika Musterfrau');
	await expect(leases).toContainText('seit 01.01.2025');
	await expect(leases).toContainText('Haupteinheit');
	// The tab bar has a "Zähler" link too; the toolbar's one carries the unit filter.
	await expect(page.locator('.toolbar').getByRole('link', { name: 'Zähler' })).toHaveAttribute(
		'href',
		`/objekte/${propertyId}/zaehler?unit=${unitId}`
	);
	// A rented unit does not offer a new lease.
	await expect(page.getByRole('link', { name: 'Mietvertrag anlegen' })).toHaveCount(0);

	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	await expect(page.getByLabel('Bezeichnung')).toHaveValue(unitName);
	await expect(page.getByLabel('Fläche in m² (optional)')).toHaveValue('64');
	await page.getByLabel('Bezeichnung').fill(`${unitName} rechts`);
	await page.getByLabel('Fläche in m² (optional)').fill('65,5');
	await page.getByLabel('Etage (optional)').fill('1. OG');
	await page.getByLabel('Zimmer (optional)').fill('2,5');
	await page.getByLabel('Notizen').fill('Balkon nach Süden');
	await page.getByRole('button', { name: 'Speichern' }).click();

	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/einheiten/${unitId}$`));
	const details = page.locator('dl.details');
	await expect(
		page.getByRole('heading', { level: 2, name: `Einheit ${unitName} rechts` })
	).toBeVisible();
	await expect(details).toContainText('65,5 m²');
	await expect(details).toContainText('1. OG');
	await expect(details).toContainText('2,5');
	await expect(details).toContainText('Balkon nach Süden');
});

test('refuses to delete a property or unit that has a lease', async ({ page }) => {
	const { propertyId, unitId, leaseId } = await seedLease(page.request);

	await page.goto(`/objekte/${propertyId}/bearbeiten`);
	// The URL check below needs the enhanced form; a click before hydration posts natively.
	await page.waitForLoadState('networkidle');
	acceptNextDialog(page);
	await page.getByRole('button', { name: 'Objekt löschen' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Das Objekt kann nicht gelöscht werden, solange Mietverträge auf seinen Einheiten liegen, auch beendete'
	);
	// The refusal links the lease that blocks it.
	await expect(
		page.getByRole('list', { name: 'Mietverträge auf dem Objekt' }).getByRole('link')
	).toHaveAttribute('href', new RegExp(`^/vertraege/${leaseId}$`));
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}/bearbeiten$`));

	await page.goto(`/objekte/${propertyId}/einheiten/${unitId}`);
	acceptNextDialog(page);
	await page.getByRole('button', { name: 'Einheit löschen' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Die Einheit kann nicht gelöscht werden, solange ein Mietvertrag auf ihr liegt, auch ein beendeter'
	);
	// Nothing was deleted.
	await page.goto(`/objekte/${propertyId}`);
	await expect(page.getByRole('list', { name: 'Einheiten' }).getByRole('listitem')).toHaveCount(1);
});

test('deletes a unit without a lease and refuses the property while an ended lease remains', async ({
	page
}) => {
	const { propertyId } = await seedLease(page.request, {
		lease: { startDate: '2024-01-01', endDate: '2024-12-31' }
	});
	const unitName = `Keller ${suffix()}`;

	await page.goto(`/objekte/${propertyId}`);
	await page.getByLabel('Bezeichnung').fill(unitName);
	await page.getByLabel('Art').selectOption({ label: 'Gewerbe' });
	await page.getByRole('button', { name: 'Einheit anlegen' }).click();
	const units = page.getByRole('list', { name: 'Einheiten' });
	await expect(units.getByRole('listitem')).toHaveCount(2);
	await units.getByRole('link', { name: unitName }).click();

	acceptNextDialog(page);
	await page.getByRole('button', { name: 'Einheit löschen' }).click();
	await expect(page).toHaveURL(new RegExp(`/objekte/${propertyId}$`));
	await expect(units.getByRole('listitem')).toHaveCount(1);
	await expect(units).not.toContainText(unitName);

	// The remaining unit has an ended lease, which still blocks deleting the property: ending a
	// lease is no way out, so the refusal says so and names the lease.
	await page.goto(`/objekte/${propertyId}/bearbeiten`);
	acceptNextDialog(page);
	await page.getByRole('button', { name: 'Objekt löschen' }).click();
	const refusal = page.getByRole('alert');
	await expect(refusal).toContainText(
		'Das Objekt kann nicht gelöscht werden, solange Mietverträge auf seinen Einheiten liegen, auch beendete: Sie bleiben mit Mietkonto und Kaution erhalten.'
	);
	await expect(refusal).toContainText(/Es liegt 1\sMietvertrag darauf/);
	await expect(refusal).not.toContainText('oder beende');
	await expect(
		refusal.getByRole('list', { name: 'Mietverträge auf dem Objekt' }).getByRole('listitem')
	).toHaveText([/seit 01\.01\.2024 bis 31\.12\.2024$/]);
});

test('deletes a property without leases', async ({ page }) => {
	const name = `Abriss ${suffix()}`;
	await page.goto('/objekte/neu');
	await page.getByLabel('Bezeichnung').fill(name);
	await page.getByLabel('Straße und Hausnummer').fill('Abrissweg 1');
	await page.getByLabel('Postleitzahl').fill('10115');
	await page.getByLabel('Ort').fill('Berlin');
	await page.getByRole('button', { name: 'Objekt anlegen' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
	await page.getByLabel('Bezeichnung').fill('Garage');
	await page.getByLabel('Art').selectOption({ label: 'Stellplatz' });
	await page.getByRole('button', { name: 'Einheit anlegen' }).click();
	await expect(page.getByRole('list', { name: 'Einheiten' })).toContainText('Garage');

	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	acceptNextDialog(page);
	await page.getByRole('button', { name: 'Objekt löschen' }).click();
	await expect(page).toHaveURL(/\/objekte$/);
	await expect(page.getByRole('list', { name: 'Objekte' })).not.toContainText(name);
});
