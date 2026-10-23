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
	await expect(page.getByRole('heading', { level: 1, name: 'Aufgaben' })).toBeVisible();
	await expect(page).toHaveTitle('Aufgaben | mietkartei');

	const deadlines = page.getByRole('table', { name: 'Fristen' });
	const ours = deadlines.getByRole('row').filter({ hasText: tenantName });

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
		deadlines.getByRole('row').filter({ hasText: propertyName }).filter({
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

	await page.getByLabel('Aufgabe', { exact: true }).fill(taskTitle);
	await page.getByLabel('Fällig am (optional)').fill('2026-12-15');
	await page.getByLabel('Gehört zu (optional)').selectOption({ label: taskPropertyName });
	await page.getByLabel('Notiz (optional)').fill('Alle Wohnungen.');
	await page.getByRole('button', { name: 'Aufgabe anlegen' }).click();
	await expect(page.getByRole('status')).toContainText(`„${taskTitle}“ wurde angelegt.`);

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

	// Edit on the task's own page.
	await openTask(page, taskTitle).getByRole('link', { name: taskTitle }).click();
	await expect(page).toHaveURL(/\/aufgaben\/[\w-]+$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(taskTitle);
	await expect(page.getByLabel('Gehört zu (optional)')).toHaveValue(/^property:/);
	await page.getByLabel('Aufgabe', { exact: true }).fill(`${taskTitle} (geändert)`);
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page).toHaveURL(/\/aufgaben$/);
	await expect(openTask(page, `${taskTitle} (geändert)`)).toHaveCount(1);

	// Delete with confirmation.
	page.once('dialog', (dialog) => dialog.accept());
	await openTask(page, `${taskTitle} (geändert)`).getByRole('button', { name: 'Löschen' }).click();
	await expect(openTask(page, taskTitle)).toHaveCount(0);
});

test('shows validation errors next to the fields', async ({ page }) => {
	await page.goto('/aufgaben');
	// Hydration sets the note's textarea to its (empty) value; typing before it would be lost.
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Notiz (optional)').fill('Ohne Titel');
	await page.getByLabel('Aufgabe', { exact: true }).evaluate((input: HTMLInputElement) => {
		input.removeAttribute('required');
	});
	await page.getByRole('button', { name: 'Aufgabe anlegen' }).click();
	await expect(page.getByText('Bitte fülle dieses Feld aus.')).toBeVisible();
	await expect(page.getByLabel('Notiz (optional)')).toHaveValue('Ohne Titel');
});

test('answers unknown tasks with 404 and refuses a lease of another account', async ({ page }) => {
	const response = await page.goto('/aufgaben/does-not-exist');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nicht gefunden');
	const origin = new URL(page.url()).origin;
	// The actions too, the task page's before they read the form.
	for (const path of ['/aufgaben/does-not-exist?/update', '/aufgaben/does-not-exist?/delete']) {
		const action = await page.request.post(path, {
			form: { title: 'Gekapert' },
			headers: { origin }
		});
		expect(action.status(), path).toBe(404);
	}
	for (const action of ['done', 'delete']) {
		const refused = await page.request.post(`/aufgaben?/${action}`, {
			form: { id: 'does-not-exist', done: 'true' },
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
