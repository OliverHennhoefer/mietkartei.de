import { fail, redirect } from '@sveltejs/kit';
import { count, eq, max } from 'drizzle-orm';
import { addMonths, daysBetween, formatDate, today } from '#lib/dates.ts';
import { parseTask, type TaskFormErrors } from '#lib/forms/tasks.ts';
import { listBankAccounts } from '#lib/server/bank/accounts.ts';
import { connectionActive, listConnections } from '#lib/server/bank/sync.ts';
import { listContractors } from '#lib/server/contractors.ts';
import { countUnmatched } from '#lib/server/bank/transactions.ts';
import { bankTransactions, costCategories } from '#lib/server/db/schema.ts';
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
	taskExpenses,
	updateTask,
	type TaskError
} from '#lib/server/tasks.ts';
import { personName, pluralize } from '#lib/format.ts';
import { listTenants } from '#lib/server/tenants.ts';
import { taskTemplates } from '#lib/task-templates.ts';
import type { Actions, PageServerLoad } from './$types';

// The start page: the first-run checklist until the account has a lease and a bank account, then
// the next deadlines, and everything that needs doing: the user's own tasks, with reminders that
// follow from the data (arrears, unmatched bank transactions, statements not loaded, vacant
// units). listBalances syncs the rent charges first, so the arrears are current when the page opens
// (the same as /mietkonto does).

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

export type Reminder = {
	/** Unique within the list: the kind and what it is about. */
	id: string;
	kind: 'arrears' | 'bank' | 'bank_import' | 'vacancy';
	title: string;
	detail?: string;
	/** Cents, for the arrears. */
	amount?: number;
	href: string;
};

/** Days after the newest transaction of a bank account until its statements count as not loaded. */
const STATEMENT_DAYS = 30;
/** Vacant units listed one by one. */
const VACANT_LISTED = 5;

const linkErrors = {
	'unknown-property': 'Dieses Objekt gibt es nicht.',
	'unknown-lease': 'Diesen Mietvertrag gibt es nicht.',
	'unknown-contractor': 'Diesen Handwerker gibt es nicht.',
	'unknown-expense':
		'Eine der Ausgaben gibt es nicht mehr, oder sie gehört inzwischen zu einer anderen Aufgabe.',
	missing: 'Diese Aufgabe gibt es nicht.'
};

/** The field a refusal of the server module belongs to. */
function refusal(reason: TaskError): TaskFormErrors {
	return reason === 'unknown-contractor'
		? { contractorId: linkErrors[reason] }
		: { link: linkErrors[reason] };
}

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
		[categories],
		latestBookings,
		connections,
		contractors,
		editingExpenses
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
			.where(eq(costCategories.accountId, accountId)),
		locals.db
			.select({
				bankAccountId: bankTransactions.bankAccountId,
				date: max(bankTransactions.bookingDate)
			})
			.from(bankTransactions)
			.where(eq(bankTransactions.accountId, accountId))
			.groupBy(bankTransactions.bankAccountId),
		listConnections(locals.db, accountId),
		listContractors(locals.db, accountId),
		editing ? taskExpenses(locals.db, accountId, editing, date) : null
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
	const settingUp = !firstRun.leases || !firstRun.bankAccounts;
	// Automatic reminders: what the data says needs doing now. They sit in the task list without a
	// checkbox and go away once the matter is handled where they link to. While setting up, the
	// first-run checklist stands in for them.
	const reminders: Reminder[] = [];
	if (!settingUp) {
		if (arrears.length > 0) {
			reminders.push({
				id: 'arrears',
				kind: 'arrears',
				title: `Rückstände bei ${pluralize(arrears.length, 'Mietvertrag', 'Mietverträgen')}`,
				detail: arrears
					.map((balance) => leases.find((lease) => lease.id === balance.leaseId))
					.map((lease) =>
						lease ? lease.tenants.map(personName).join(', ') || leaseLabel(lease) : ''
					)
					.filter(Boolean)
					.join(' · '),
				amount: arrears.reduce((sum, balance) => sum + balance.overdue, 0),
				href: '/mietkonto?filter=rueckstaende'
			});
		}
		if (unmatched > 0) {
			reminders.push({
				id: 'bank',
				kind: 'bank',
				title: `${pluralize(unmatched, 'Bankumsatz', 'Bankumsätze')} zuordnen`,
				detail:
					'Mietzahlungen und Ausgaben, die noch keinem Mietvertrag oder keiner Kostenart zugeordnet sind',
				href: '/bank'
			});
		}
		// A bank account whose newest transaction is over a month old: its statements are not loaded.
		// One the Bankabruf fetches on its own needs nothing, unless its authorization ran out.
		const now = new Date();
		for (const bankAccount of bankAccounts) {
			const connection = connections.find((row) => row.bankAccountId === bankAccount.id);
			const fetching = connection !== undefined && connectionActive(connection, now);
			if (fetching) continue;
			if (connection?.sessionId) {
				reminders.push({
					id: `bank_import:${bankAccount.id}`,
					kind: 'bank_import',
					title: `Bankabruf erneuern: ${bankAccount.name}`,
					detail: 'Die Freigabe bei der Bank ist abgelaufen, neue Umsätze kommen nicht mehr an.',
					href: `/bank/konten/${bankAccount.id}/abruf`
				});
				continue;
			}
			const latest = latestBookings.find((row) => row.bankAccountId === bankAccount.id)?.date;
			if (latest && daysBetween(latest, date) <= STATEMENT_DAYS) continue;
			reminders.push({
				id: `bank_import:${bankAccount.id}`,
				kind: 'bank_import',
				title: `Kontoauszug laden: ${bankAccount.name}`,
				detail: latest
					? `Der letzte Umsatz ist vom ${formatDate(latest)}.`
					: 'Auf diesem Konto sind noch keine Umsätze.',
				href: '/bank/import'
			});
		}
		// A vacant unit asks for its lease; past five, one row leads to the rest.
		for (const row of vacant.slice(0, VACANT_LISTED)) {
			reminders.push({
				id: `vacancy:${row.unit.id}`,
				kind: 'vacancy',
				title: `Mietvertrag anlegen: ${row.unit.name} · ${row.property.name}`,
				detail: 'Die Einheit steht leer.',
				href: `/vertraege/neu?unitId=${row.unit.id}`
			});
		}
		if (vacant.length > VACANT_LISTED) {
			reminders.push({
				id: 'vacancy',
				kind: 'vacancy',
				title: `${pluralize(vacant.length - VACANT_LISTED, 'weitere Einheit', 'weitere Einheiten')} ohne Mietvertrag`,
				href: '/objekte'
			});
		}
	}
	return {
		today: date,
		reminders,
		firstRun: settingUp ? firstRun : null,
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
		// The banner at the top: the deadlines of the next two weeks and those overdue, at least the
		// next one, at most three. The whole list is on /fristen.
		upcoming: deadlines
			.filter(
				(deadline, index) =>
					index === 0 || deadline.overdue || daysBetween(date, deadline.date) <= 14
			)
			.slice(0, 3),
		editingExpenses,
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
		})),
		contractors: contractors.map((contractor) => ({
			id: contractor.id,
			name: contractor.trade ? `${contractor.name} (${contractor.trade})` : contractor.name
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseTask(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createTask(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			return fail(400, { errors: refusal(created.reason), values: result.values });
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
		// The edit dialog lists the expenses that can be linked; the checked ones are linked.
		const expenseIds = form.has('expenses')
			? form.getAll('expenseId').map((value) => String(value))
			: undefined;
		const updated = await updateTask(locals.db, auditContext(locals), id, result.data, expenseIds);
		if (!updated.ok) {
			if (updated.reason === 'missing') return fail(404, { message: linkErrors.missing });
			if (updated.reason === 'unknown-expense') {
				return fail(400, {
					edit: true,
					message: linkErrors[updated.reason],
					values: result.values
				});
			}
			return fail(400, {
				edit: true,
				errors: refusal(updated.reason),
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
