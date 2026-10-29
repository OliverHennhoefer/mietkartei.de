import { expect, test, type Page } from '@playwright/test';
import { addMonths, formatDate, today } from '../src/lib/dates';
import { seedForeignLease, seedLease, seedRows } from './seed';

// The deadlines come from a lease that ends next month (seeded); the tasks are driven through the
// page. Names carry a random suffix, so the rows of this test are told apart from other tests'.

const suffix = crypto.randomUUID().slice(0, 6);
const tenantName = `Fristmann-${suffix}`;
const propertyName = `Fristenhaus ${suffix}`;
const taskTitle = `Rauchmelder prüfen ${suffix}`;
const taskPropertyName = `Aufgabenhaus ${suffix}`;

function openTask(page: Page, title: string) {
	return page.getByRole('list', { name: 'Offene Aufgaben' }).getByRole('listitem').filter({
		hasText: title
	});
}

test('shows the deadlines of a lease that ends next month', async ({ page }) => {
	const endDate = addMonths(today(), 1);
	await seedLease(page.request, {
		property: { name: propertyName },
		tenant: { lastName: tenantName },
		lease: { startDate: '2025-01-01', endDate }
	});

	await page.goto('/aufgaben');
	await page.getByRole('link', { name: 'Alle Fristen' }).click();
	await expect(page).toHaveURL(/\/fristen$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Fristen' })).toBeVisible();
	await expect(page).toHaveTitle('Fristen | mietkartei');

	const deadlines = page.getByRole('list', { name: 'Fristen' });
	const ours = deadlines.getByRole('listitem').filter({ hasText: tenantName });

	const leaseEnd = ours.filter({ hasText: 'Vertragsende' });
	await expect(leaseEnd).toHaveCount(1);
	await expect(leaseEnd).toContainText(formatDate(endDate));
	await expect(leaseEnd.getByRole('link', { name: 'Vertragsende' })).toHaveAttribute(
		'href',
		/^\/vertraege\/[\w-]+$/
	);

	const depositReturn = ours.filter({ hasText: 'Kaution abrechnen' });
	await expect(depositReturn).toHaveCount(1);
	await expect(depositReturn).toContainText(formatDate(addMonths(endDate, 6)));
	await expect(depositReturn.getByRole('link')).toHaveAttribute('href', /\/kaution$/);

	// The deposit instalments of January to March 2025 are long overdue and stay listed.
	const instalment = ours.filter({ hasText: 'Kaution: 1. Rate fällig' });
	await expect(instalment).toHaveCount(1);
	await expect(instalment).toContainText('06.01.2025');
	await expect(instalment).toContainText('überfällig');

	// The statement for 2025 is due by the end of 2026.
	await expect(
		deadlines.getByRole('listitem').filter({ hasText: propertyName }).filter({
			hasText: 'Betriebskostenabrechnung 2025'
		})
	).toContainText('31.12.2026');
});

test('creates, completes, reopens, edits and deletes a task', async ({ page }) => {
	// Its own property, so the test does not depend on the one above.
	await seedRows(page.request, 'properties', [
		{ name: taskPropertyName, street: 'Aufgabenweg 1', postalCode: '10115', city: 'Berlin' }
	]);
	await page.goto('/aufgaben');

	// The form opens in a dialog from the header and closes once the task is created.
	await page.getByRole('link', { name: 'Aufgabe anlegen' }).click();
	await expect(page.getByRole('dialog', { name: 'Aufgabe anlegen' })).toBeVisible();
	await page.getByLabel('Aufgabe', { exact: true }).fill(taskTitle);
	await page.getByLabel('Fällig am (optional)').fill('2026-12-15');
	await page.getByLabel('Gehört zu (optional)').selectOption({ label: taskPropertyName });
	await page.getByLabel('Notiz (optional)').fill('Alle Wohnungen.');
	await page.getByRole('button', { name: 'Aufgabe anlegen' }).click();
	await expect(page.getByRole('status')).toContainText(`„${taskTitle}“ wurde angelegt.`);
	await expect(page.getByRole('dialog')).toBeHidden();

	const item = openTask(page, taskTitle);
	await expect(item).toHaveCount(1);
	await expect(item).toContainText('bis 15.12.2026');
	await expect(item).toContainText('Alle Wohnungen.');
	await expect(item.getByRole('link', { name: taskPropertyName })).toHaveAttribute(
		'href',
		/^\/objekte\/[\w-]+$/
	);

	// Done: the checkbox submits and the list re-renders, so click rather than check (which
	// would wait for the removed element to stay checked).
	await page.getByRole('checkbox', { name: `„${taskTitle}“ erledigt` }).click();
	await expect(openTask(page, taskTitle)).toHaveCount(0);
	await page.getByText(/erledigte Aufgabe/).click();
	const done = page.getByRole('list', { name: 'Erledigte Aufgaben' }).getByRole('listitem').filter({
		hasText: taskTitle
	});
	await expect(done).toHaveCount(1);
	// The day it was ticked off, in Berlin.
	await expect(done).toContainText(`erledigt am ${formatDate(today())}`);

	await done.getByRole('button', { name: 'wieder öffnen' }).click();
	await expect(openTask(page, taskTitle)).toHaveCount(1);

	// Edit in the dialog over the list; the URL names the task, so the back button closes it.
	await openTask(page, taskTitle).getByRole('link', { name: taskTitle }).click();
	await expect(page).toHaveURL(/\/aufgaben\?bearbeiten=[\w-]+$/);
	const edit = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
	await expect(edit.getByLabel('Gehört zu (optional)')).toHaveValue(/^property:/);
	await page.goBack();
	await expect(edit).toBeHidden();
	await openTask(page, taskTitle).getByRole('link', { name: taskTitle }).click();
	await edit.getByLabel('Aufgabe', { exact: true }).fill(`${taskTitle} (geändert)`);
	await edit.getByRole('button', { name: 'Speichern' }).click();
	await expect(edit).toBeHidden();
	await expect(page).toHaveURL(/\/aufgaben$/);
	await expect(openTask(page, `${taskTitle} (geändert)`)).toHaveCount(1);

	// The list has no delete button; the dialog has, with confirmation.
	await expect(openTask(page, taskTitle).getByRole('button', { name: 'Löschen' })).toHaveCount(0);
	await openTask(page, taskTitle)
		.getByRole('link', { name: `${taskTitle} (geändert)` })
		.click();
	page.once('dialog', (dialog) => dialog.accept());
	await edit.getByRole('button', { name: 'Löschen' }).click();
	await expect(edit).toBeHidden();
	await expect(openTask(page, taskTitle)).toHaveCount(0);
});

test('fills a repeating task from a template and brings it back when done', async ({ page }) => {
	const title = `Heizung warten ${suffix}`;
	await page.goto('/aufgaben');
	await page.getByRole('link', { name: 'Aufgabe anlegen' }).click();
	const dialog = page.getByRole('dialog', { name: 'Aufgabe anlegen' });
	await dialog.getByRole('link', { name: 'Heizung warten lassen' }).click();
	await expect(page).toHaveURL(/\?vorlage=heizungswartung/);
	// The template fills the form, and the dialog stays open.
	await expect(dialog.getByLabel('Art')).toHaveValue('maintenance');
	await expect(dialog.getByLabel('Wiederholen')).toHaveValue('12');
	await expect(dialog.getByLabel('Notiz (optional)')).toHaveValue(/BetrKV/);

	await page.getByLabel('Aufgabe', { exact: true }).fill(title);
	await page.getByLabel('Fällig am (optional)').fill(today());
	await page.getByRole('button', { name: 'Aufgabe anlegen' }).click();
	await expect(page.getByRole('status')).toContainText(`„${title}“ wurde angelegt.`);
	const item = openTask(page, title);
	await expect(item).toContainText('Wartung');
	await expect(item).toContainText('jährlich');

	await page.getByRole('checkbox', { name: `„${title}“ erledigt` }).click();
	await expect(openTask(page, title)).toContainText(`bis ${formatDate(addMonths(today(), 12))}`);
});

test('shows validation errors next to the fields', async ({ page }) => {
	await page.goto('/aufgaben');
	// Hydration sets the note's textarea to its (empty) value; typing before it would be lost.
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: 'Aufgabe anlegen' }).click();
	await page.getByLabel('Notiz (optional)').fill('Ohne Titel');
	await page.getByLabel('Aufgabe', { exact: true }).evaluate((input: HTMLInputElement) => {
		input.removeAttribute('required');
	});
	await page.getByRole('button', { name: 'Aufgabe anlegen' }).click();
	await expect(page.getByText('Bitte fülle dieses Feld aus.')).toBeVisible();
	await expect(page.getByLabel('Notiz (optional)')).toHaveValue('Ohne Titel');
	await expect(page.getByRole('dialog', { name: 'Aufgabe anlegen' })).toBeVisible();
});

test('answers unknown tasks with 404 and refuses a lease of another account', async ({ page }) => {
	// A link to a task that is gone shows the list without the dialog.
	await page.goto('/aufgaben?bearbeiten=does-not-exist');
	await expect(page.getByRole('heading', { level: 1, name: 'Aufgaben' })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const origin = new URL(page.url()).origin;
	for (const action of ['done', 'update', 'delete']) {
		const refused = await page.request.post(`/aufgaben?/${action}`, {
			form: { id: 'does-not-exist', done: 'true', title: 'Gekapert' },
			headers: { origin }
		});
		expect(refused.status(), action).toBe(404);
	}

	// A link to a lease or property of another account is refused like an unknown one.
	const foreign = await seedForeignLease(page.request);
	for (const [link, message] of [
		[`lease:${foreign.leaseId}`, 'Diesen Mietvertrag gibt es nicht.'],
		[`property:${foreign.propertyId}`, 'Dieses Objekt gibt es nicht.']
	]) {
		const created = await page.request.post('/aufgaben?/create', {
			form: { title: `Fremd ${suffix}`, link },
			headers: { origin }
		});
		expect(created.status()).toBe(400);
		expect(await created.text()).toContain(message);
	}
	await page.goto('/aufgaben');
	await expect(openTask(page, `Fremd ${suffix}`)).toHaveCount(0);
});

test('names the Dienstleister of a Reparatur and links the bill that paid for it', async ({
	page
}) => {
	const serviceProvider = `Elektro Lindner ${suffix}`;
	const title = `Hofbeleuchtung defekt ${suffix}`;
	const bill = `Bewegungsmelder getauscht ${suffix}`;
	await page.goto('/aufgaben');
	await page.getByRole('link', { name: 'Dienstleister' }).first().click();
	await expect(page).toHaveURL(/\/dienstleister$/);
	await page.getByLabel('Name').fill(serviceProvider);
	await page.getByLabel('Leistung (optional)').fill('Elektro');
	await page.getByLabel('Telefon (optional)').fill('030 9182 4410');
	await page.getByRole('button', { name: 'Dienstleister anlegen' }).last().click();
	await expect(page.getByRole('status')).toContainText(`„${serviceProvider}“ wurde angelegt.`);
	await expect(page.getByRole('table', { name: 'Dienstleister' })).toContainText('030 9182 4410');

	await seedRows(page.request, 'expenses', [
		{ date: today(), amount: 18900, category: 'maintenance', description: bill }
	]);
	await page.goto('/aufgaben?neu');
	const create = page.getByRole('dialog', { name: 'Aufgabe anlegen' });
	await create.getByLabel('Aufgabe', { exact: true }).fill(title);
	await create.getByLabel('Art').selectOption({ label: 'Reparatur' });
	await expect(create.getByLabel('Dienstleister')).toHaveValue('');
	await create.getByLabel('Dienstleister').selectOption({ label: `${serviceProvider} (Elektro)` });
	await create.getByRole('button', { name: 'Aufgabe anlegen' }).click();
	await expect(create).toBeHidden();
	const item = openTask(page, title);
	await expect(item).toContainText('Reparatur');
	await expect(item.getByRole('link', { name: serviceProvider })).toHaveAttribute(
		'href',
		/^\/dienstleister\?bearbeiten=/
	);

	await item.getByRole('link', { name: title }).click();
	const edit = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
	await edit.getByRole('checkbox', { name: new RegExp(bill) }).check();
	await edit.getByRole('button', { name: 'Speichern' }).click();
	await expect(edit).toBeHidden();
	await expect(openTask(page, title)).toContainText('Kosten 189,00');

	// The bill took the Dienstleister of the Reparatur; the Ausgaben sum it up by Dienstleister.
	await page.goto('/auswertung/ausgaben');
	await expect(page.getByRole('row', { name: new RegExp(bill) })).toContainText(serviceProvider);
	await expect(
		page
			.getByRole('table', { name: /nach Dienstleister/ })
			.getByRole('row', { name: new RegExp(serviceProvider) })
	).toContainText('189,00');
});
