import { error, fail } from '@sveltejs/kit';
import { parseBankAccount, type BankAccountInput } from '#lib/forms/bank.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	createBankAccount,
	deleteBankAccount,
	listBankAccounts
} from '#lib/server/bank/accounts.ts';
import { auditContext, requireAccount } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const accountId = requireAccount(locals);
	return { bankAccounts: await listBankAccounts(locals.db, accountId) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const result = parseBankAccount(await request.formData());
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });
		const created = await createBankAccount(locals.db, auditContext(locals), result.data);
		if (!created.ok) {
			const errors: FieldErrors<BankAccountInput> = {
				iban: 'Ein Konto mit dieser IBAN gibt es schon.'
			};
			return fail(400, {
				errors,
				values: { ...result.data, bic: result.data.bic ?? '' }
			});
		}
		return { created: result.data.name };
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const outcome = await deleteBankAccount(locals.db, auditContext(locals), id);
		if (outcome === 'missing') error(404, 'Diese Bankverbindung gibt es nicht.');
		if (outcome === 'in-use') {
			return fail(400, {
				message:
					'Diese Bankverbindung hat zugeordnete Umsätze und kann nicht gelöscht werden. Hebe die Zuordnungen zuerst auf.'
			});
		}
		return { deleted: true };
	}
};
