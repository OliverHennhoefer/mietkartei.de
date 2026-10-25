import { error, fail } from '@sveltejs/kit';
import { dayOf } from '#lib/dates.ts';
import { parseBankAccount, type BankAccountInput } from '#lib/forms/bank.ts';
import type { FieldErrors } from '#lib/forms/fields.ts';
import {
	createBankAccount,
	deleteBankAccount,
	listBankAccounts
} from '#lib/server/bank/accounts.ts';
import { bankSyncEnabled, deleteSession } from '#lib/server/bank/enable-banking.ts';
import {
	connectionActive,
	endConnection,
	listConnections,
	syncConnection
} from '#lib/server/bank/sync.ts';
import { auditContext, requireOwner, requireUser } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Bankverbindungen are an owner's business: a manager sees a short note instead of the list, and
// every action insists on the owner role.
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	const query = { abruf: url.searchParams.get('abruf') };
	if (user.role !== 'owner') return { ownerOnly: true, bankAccounts: [], sync: null, query };
	const [bankAccounts, connections] = await Promise.all([
		listBankAccounts(locals.db, user.accountId),
		bankSyncEnabled() ? listConnections(locals.db, user.accountId) : []
	]);
	const now = new Date();
	// The Bankabruf of each bank account, by its id; only while the instance offers it.
	const sync = bankSyncEnabled()
		? Object.fromEntries(
				connections.map((connection) => [
					connection.bankAccountId,
					{
						bank: connection.aspspName,
						active: connectionActive(connection, now),
						pending: !connection.sessionId,
						validUntil: connection.validUntil ? dayOf(connection.validUntil) : null,
						lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
						lastError: connection.lastError
					}
				])
			)
		: null;
	return { ownerOnly: false, bankAccounts, sync, query };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireOwner(locals);
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
		const user = requireOwner(locals);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// The access at the bank ends with the bank account; its row goes by cascade.
		const session = bankSyncEnabled()
			? (await listConnections(locals.db, user.accountId)).find(
					(connection) => connection.bankAccountId === id
				)?.sessionId
			: undefined;
		const outcome = await deleteBankAccount(locals.db, auditContext(locals), id);
		if (outcome === 'deleted' && session) await deleteSession(session).catch(() => undefined);
		if (outcome === 'missing') error(404, 'Diese Bankverbindung gibt es nicht.');
		if (outcome === 'in-use') {
			return fail(400, {
				message:
					'Diese Bankverbindung hat zugeordnete Umsätze und kann nicht gelöscht werden. Hebe die Zuordnungen zuerst auf.'
			});
		}
		return { deleted: true };
	},

	/** Fetches the transactions of one bank account now, whenever it last did. */
	sync: async ({ request, locals }) => {
		const user = requireOwner(locals);
		if (!bankSyncEnabled()) error(404, 'Auf dieser Instanz gibt es keinen Bankabruf.');
		const id = String((await request.formData()).get('id') ?? '');
		const connection = (await listConnections(locals.db, user.accountId)).find(
			(entry) => entry.bankAccountId === id
		);
		if (!connection || !connectionActive(connection, new Date())) {
			return fail(400, { message: 'Für dieses Konto ist kein Bankabruf freigegeben.' });
		}
		try {
			const result = await syncConnection(locals.db, auditContext(locals), connection, {
				force: true
			});
			return { synced: result ?? { imported: 0, assigned: 0 } };
		} catch {
			return fail(502, {
				message:
					'Die Bank hat die Umsätze gerade nicht geliefert. Versuche es später noch einmal oder erneuere die Freigabe.'
			});
		}
	},

	/** Ends the Bankabruf of one bank account; its transactions stay. */
	end: async ({ request, locals }) => {
		requireOwner(locals);
		if (!bankSyncEnabled()) error(404, 'Auf dieser Instanz gibt es keinen Bankabruf.');
		const id = String((await request.formData()).get('id') ?? '');
		let ended: boolean;
		try {
			ended = await endConnection(locals.db, auditContext(locals), id);
		} catch {
			return fail(502, {
				message: 'Die Bank hat die Freigabe gerade nicht beendet. Versuche es später noch einmal.'
			});
		}
		if (!ended) error(404, 'Für dieses Konto gibt es keinen Bankabruf.');
		return { ended: true };
	}
};
