import { fail, redirect } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { addMonths, today } from '#lib/dates.ts';
import { parseTask } from '#lib/forms/tasks.ts';
import { listBankAccounts } from '#lib/server/bank/accounts.ts';
import { countUnmatched } from '#lib/server/bank/transactions.ts';
import { costCategories } from '#lib/server/db/schema.ts';
import { listDeadlines } from '#lib/server/deadlines.ts';
import { leaseLabel, listLeases, listUnitsWithProperty } from '#lib/server/leases.ts';
import { listBalances } from '#lib/server/ledger.ts';
import { listProperties } from '#lib/server/properties.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import {
	createTask,
	deleteTask,
	getTask,
	listTasks,
	setDone,
	updateTask
} from '#lib/server/tasks.ts';
import { listTenants } from '#lib/server/tenants.ts';
import { taskTemplates } from '#lib/task-templates.ts';
import type { Actions, PageServerLoad } from './$types';

// The start page: the first-run checklist until the account has a lease and a bank account, the
// user's own tasks, what needs doing outside the deadlines (arrears, unmatched bank transactions,
// vacant units) and the deadlines. listBalances syncs the rent charges first, so the arrears are
// current when the page opens (the same as /mietkonto does).

export type FirstRun = {
	properties: boolean;
	units: boolean;
	tenants: boolean;
	leases: boolean;
	bankAccounts: boolean;
	/**
	 * The default cost categories are created when a Betriebskosten page is first opened, or with
	 * the demo data.
	 */
	categories: boolean;
	/** Where "Einheit anlegen" leads: the first property's page, which has the unit form. */
	firstPropertyId: string | null;
};

const linkErrors = {
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'unknown-lease': 'Diesen Mietvertrag gibt es nicht.',
	missing: 'Diese Aufgabe gibt es nicht.'
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const accountId = requireAccount(locals);
	// ?vorlage=<key> fills the create form from a template.
	const template = taskTemplates.find((entry) => entry.key === url.searchParams.get('vorlage'));
	// ?bearbeiten=<id> opens the task in the edit dialog.
	const editId = url.searchParams.get('bearbeiten');
	const editing = editId ? ((await getTask(locals.db, accountId, editId)) ?? null) : null;
	const date = today();
	const [
		deadlines,
		tasks,
		properties,
		leases,
		tenants,
		units,
		balances,
		unmatched,
		bankAccounts,
		[categories]
	] = await Promise.all([
		listDeadlines(locals.db, accountId, { to: addMonths(date, 12) }),
		listTasks(locals.db, accountId),
		listProperties(locals.db, accountId, { archived: true }),
		listLeases(locals.db, accountId),
		listTenants(locals.db, accountId, { archived: true }),
		listUnitsWithProperty(locals.db, accountId, { archived: true }),
		listBalances(locals.db, accountId),
		countUnmatched(locals.db, accountId),
		listBankAccounts(locals.db, accountId),
		locals.db
			.select({ value: count() })
			.from(costCategories)
			.where(eq(costCategories.accountId, accountId))
	]);

	// Rückstand is what is overdue today, not this month's rent before its due day.
	const arrears = balances.filter((balance) => balance.overdue > 0);
	const occupied = new Set(
		leases
			.filter((lease) => lease.active)
			.flatMap((lease) => [lease.unitId, ...lease.extraUnits.map((unit) => unit.id)])
	);
	// Archived properties (sold) count for the first steps, but not as vacancy.
	const vacant = units.filter((row) => !row.property.archivedAt && !occupied.has(row.unit.id));
	const firstRun: FirstRun = {
		properties: properties.length > 0,
		units: units.length > 0,
		tenants: tenants.length > 0,
		leases: leases.length > 0,
		bankAccounts: bankAccounts.length > 0,
		categories: categories.value > 0,
		firstPropertyId: properties[0]?.id ?? null
	};
	return {
		today: date,
		firstRun: firstRun.leases && firstRun.bankAccounts ? null : firstRun,
		attention: {
			arrearsTotal: arrears.reduce((sum, balance) => sum + balance.overdue, 0),
			arrearsCount: arrears.length,
			unmatched,
			vacantCount: vacant.length,
			vacant: vacant.slice(0, 5).map((row) => ({
				unitId: row.unit.id,
				propertyId: row.property.id,
				label: `${row.unit.name} · ${row.property.name}`
			}))
		},
		template: template
			? {
					key: template.key,
					title: template.title,
					category: template.category,
					repeatMonths: String(template.repeatMonths),
					note: template.note
				}
			: null,
		editing,
		deadlines,
		open: tasks.open,
		done: tasks.done,
		// Archived properties only for the task in the edit dialog that is linked to one.
		properties: properties
			.filter((property) => !property.archivedAt || property.id === editing?.propertyId)
			.map((property) => ({ id: property.id, name: property.name })),
		leases: leases.map((lease) => ({
			id: lease.id,
			label: leaseLabel(lease),
			active: lease.active
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseTask(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createTask(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			return fail(400, { errors: { link: linkErrors[created.reason] }, values: result.values });
		}
		return { created: result.data.title };
	},
	done: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const done = form.get('done') === 'true';
		if (!(await setDone(locals.db, auditContext(locals), id, done))) {
			return fail(404, { message: 'Diese Aufgabe gibt es nicht.' });
		}
		return { toggled: id };
	},
	update: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const result = parseTask(form);
		if (!result.ok) {
			return fail(400, { edit: true, errors: result.errors, values: result.values });
		}
		const updated = await updateTask(locals.db, auditContext(locals), id, result.data);
		if (!updated.ok) {
			if (updated.reason === 'missing') return fail(404, { message: linkErrors.missing });
			return fail(400, {
				edit: true,
				errors: { link: linkErrors[updated.reason] },
				values: result.values
			});
		}
		redirect(303, '/aufgaben');
	},
	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!(await deleteTask(locals.db, auditContext(locals), id))) {
			return fail(404, { message: 'Diese Aufgabe gibt es nicht.' });
		}
		redirect(303, '/aufgaben');
	}
};
