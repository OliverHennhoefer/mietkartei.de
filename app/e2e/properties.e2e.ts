import { expect, test, type Page } from '@playwright/test';
import { seedForeignLease, seedLease, seedRows } from './seed';

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
	await expect(
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Objekte' })
	).toHaveAttribute('aria-current', 'page');
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

	const { propertyId, unitId } = await seedLease(page.request);
	const unit = await page.goto(`/objekte/${propertyId}/einheiten/does-not-exist`);
	expect(unit?.status()).toBe(404);

	// Real ids of another account answer 404 too, and so does a unit under the wrong property.
	const foreign = await seedForeignLease(page.request);
	for (const path of [
		`/objekte/${foreign.propertyId}`,
		`/objekte/${foreign.propertyId}/bearbeiten`,
		`/objekte/${foreign.propertyId}/einheiten/${foreign.unitId}`,
		`/objekte/${propertyId}/einheiten/${foreign.unitId}`,
		`/objekte/${foreign.propertyId}/einheiten/${unitId}`
	]) {
		const response = await page.goto(path);
		expect(response?.status(), path).toBe(404);
	}
});

test('edits a property and shows its occupancy in the list', async ({ page }) => {
	const name = `Testhaus ${suffix()}`;
	const { propertyId } = await seedLease(page.request, { property: { name } });
	const listed = page
		.getByRole('list', { name: 'Objekte' })
		.getByRole('listitem')
		.filter({ hasText: name });

	await page.goto('/objekte');
	await expect(listed).toContainText('1 Einheit · 1 laufender Mietvertrag · kein Leerstand');
	// A second unit without a lease is vacant.
	await seedRows(page.request, 'units', [{ propertyId, name: 'Dachboden', kind: 'apartment' }]);
	await page.reload();
	await expect(listed).toContainText(
		'2 Einheiten · 1 laufender Mietvertrag · Leerstand: 1 Einheit'
	);

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
	// The unit pages belong to the Einheiten tab.
	const tabs = page.getByRole('navigation', { name: 'Bereiche' });
	await expect(tabs.getByRole('link', { name: 'Einheiten' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(tabs.getByRole('link', { name: 'Abrechnungskreise' })).not.toHaveAttribute(
		'aria-current'
	);
	await expect(page.getByText('Vermietet', { exact: true })).toBeVisible();
	const leases = page.getByRole('table', { name: 'Mietverträge' });
	await expect(leases).toContainText('Erika Musterfrau');
	await expect(leases).toContainText('seit 01.01.2025');
	await expect(leases).toContainText('Aktiv');
	await expect(leases).toContainText('Haupteinheit');
	await expect(leases.getByRole('link', { name: 'Erika Musterfrau' })).toHaveAttribute(
		'href',
		`/vertraege/${leaseId}`
	);
	// A rented unit does not offer a new lease.
	await expect(page.getByRole('link', { name: 'Mietvertrag anlegen' })).toHaveCount(0);

	await page.getByRole('link', { name: 'Bearbeiten' }).click();
	await expect(page.getByLabel('Bezeichnung')).toHaveValue(unitName);
	await expect(tabs.getByRole('link', { name: 'Einheiten' })).toHaveAttribute(
		'aria-current',
		'page'
	);
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

test('names the lease that keeps a property or unit instead of offering to delete it', async ({
	page
}) => {
	const unitName = `Wohnung ${suffix()}`;
	const { propertyId, unitId, leaseId } = await seedLease(page.request, {
		unit: { name: unitName }
	});

	// The page says up front what keeps the property and links the lease; there is no button.
	await page.goto(`/objekte/${propertyId}/bearbeiten`);
	await expect(
		page.getByText('Auf den Einheiten des Objekts liegt ein Mietvertrag, auch beendete zählen')
	).toBeVisible();
	const blocking = page.getByRole('list', { name: 'Was das Löschen verhindert' });
	await expect(blocking.getByRole('listitem')).toHaveText([
		new RegExp(`^${unitName} · .+: Erika Muster-[0-9a-f]{4}, seit 01\\.01\\.2025$`)
	]);
	await expect(blocking.getByRole('link')).toHaveAttribute('href', `/vertraege/${leaseId}`);
	await expect(page.getByRole('button', { name: 'Objekt löschen' })).toHaveCount(0);

	await page.goto(`/objekte/${propertyId}/einheiten/${unitId}`);
	await expect(page.getByText('Auf der Einheit liegt ein Mietvertrag')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Einheit löschen' })).toHaveCount(0);
});

test('deletes a unit without a lease and keeps the property while an ended lease remains', async ({
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

	// The remaining unit has an ended lease, which still keeps the property; the page names it.
	await page.goto(`/objekte/${propertyId}/bearbeiten`);
	await expect(
		page.getByText('Sie bleiben mit Mietkonto und Kaution erhalten.', { exact: false })
	).toBeVisible();
	await expect(
		page.getByRole('list', { name: 'Was das Löschen verhindert' }).getByRole('listitem')
	).toHaveText([/01\.01\.2024 bis 31\.12\.2024$/]);
	await expect(page.getByRole('button', { name: 'Objekt löschen' })).toHaveCount(0);
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
	await expect(
		page.getByRole('list', { name: 'Was mitgelöscht wird' }).getByRole('listitem')
	).toHaveText(['1\u00a0Einheit', 'die Umlageschlüssel und Abrechnungskreise des Objekts']);
	acceptNextDialog(page);
	await page.getByRole('button', { name: 'Objekt löschen' }).click();
	await expect(page).toHaveURL(/\/objekte$/);
	await expect(page.getByRole('list', { name: 'Objekte' })).not.toContainText(name);
});

test('shows each property on a map and hides the maps in the settings', async ({ page }) => {
	// Not "Kartenhaus": later tests look for the label "Art", which matches inside option texts.
	const name = `Neonpunkt ${suffix()}`;
	await seedLease(page.request, { property: { name, city: 'Berlin' } });
	await page.goto('/objekte');
	// The street map of scripts/map-fixture.js, drawn by the server around the postal code.
	const tile = page.getByRole('button', { name: `${name} auf der Karte zeigen` });
	const image = tile.locator('img');
	await expect(image).toHaveAttribute('src', /\/karte\?v=/);
	await image.scrollIntoViewIfNeeded();
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBe(480);
	await expect(page.getByText('Straßenkarten: © OpenStreetMap-Mitwirkende')).toBeVisible();

	// The large map is the interactive street map: tiles drawn by the server, the property as a
	// dot named in its label, zoomable and leading to the property.
	await tile.click();
	const map = page.getByRole('dialog', { name: 'Deine Objekte auf der Karte' });
	await expect(map).toBeVisible();
	const tiles = map.locator('img.leaflet-tile-loaded');
	await expect(tiles.first()).toHaveAttribute('src', /\/objekte\/karte\/\d+\/\d+\/\d+\?v=/);
	const zoom = Number((await tiles.first().getAttribute('src'))!.split('/')[3]);
	// Other tests' properties may share the postal code and the dot.
	await expect(map.locator('.street-map-label')).toContainText(name);
	await map.getByRole('button', { name: 'Verkleinern' }).click();
	await expect(
		map.locator(`img.leaflet-tile-loaded[src*="/karte/${zoom - 1}/"]`).first()
	).toBeVisible();
	await map.getByRole('button', { name: 'Ganz Deutschland' }).click();
	await expect(map.getByRole('button', { name: 'Auf Objekte zoomen' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(map).toHaveCount(0);
	await tile.click();
	// The dots are buttons for the keyboard too.
	await map.locator('.street-map-dot.selected').focus();
	await page.keyboard.press('Enter');
	const figures = map.locator('.street-map-popup');
	await expect(figures).toContainText('kein Leerstand');
	await expect(figures).toContainText('Kaltmiete');
	await expect(figures.getByRole('link').first()).toBeFocused();
	await figures.getByRole('link', { name }).focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/objekte\/[\w-]+$/);
	await expect(page.getByRole('heading', { name })).toBeVisible();

	await page.goto('/einstellungen/darstellung');
	const setting = page.getByLabel('Karte bei den Objekten zeigen');
	await expect(setting).toBeChecked();
	await setting.uncheck();
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Gespeichert.')).toBeVisible();
	await page.goto('/objekte');
	await expect(page.getByRole('list', { name: 'Objekte' })).toContainText(name);
	await expect(page.locator('.map-tile')).toHaveCount(0);

	await page.goto('/einstellungen/darstellung');
	await page.getByLabel('Karte bei den Objekten zeigen').check();
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Gespeichert.')).toBeVisible();
});

test('switches between light and dark colours', async ({ page }) => {
	const html = page.locator('html');
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/einstellungen/darstellung');
	await expect(page.getByLabel('Wie das Gerät')).toBeChecked();
	await expect(html).toHaveAttribute('data-theme', 'system');

	await page.getByLabel('Dunkel').check();
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(html).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(27, 28, 31)');
	await page.goto('/objekte');
	await expect(html).toHaveAttribute('data-theme', 'dark');

	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/einstellungen/darstellung');
	await page.getByLabel('Hell').check();
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(html).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

	await page.getByLabel('Wie das Gerät').check();
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(html).toHaveAttribute('data-theme', 'system');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(27, 28, 31)');
});
