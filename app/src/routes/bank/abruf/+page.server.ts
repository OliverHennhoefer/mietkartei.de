import { error, redirect } from '@sveltejs/kit';
import { bankSyncEnabled, EnableBankingError } from '#lib/server/bank/enable-banking.ts';
import { finishConnection, listConnections, syncConnection } from '#lib/server/bank/sync.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// Where the bank sends the landlord back after the authorization, with `code` and `state`, or
// with `error` when it was refused or cancelled. A working one stores the session and fetches
// the first transactions at once.

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!bankSyncEnabled()) error(404, 'Auf dieser Instanz gibt es keinen Bankabruf.');
	const user = requireOwner(locals);
	const state = url.searchParams.get('state') ?? '';
	const code = url.searchParams.get('code') ?? '';
	if (url.searchParams.get('error') || !state || !code) {
		return {
			message: 'Die Bank hat den Zugriff nicht freigegeben. Du kannst es erneut versuchen.'
		};
	}
	let outcome;
	try {
		outcome = await finishConnection(locals.db, auditContext(locals), state, code);
	} catch (cause) {
		if (!(cause instanceof EnableBankingError)) throw cause;
		console.error(cause.message);
		return { message: 'Die Freigabe konnte nicht abgeschlossen werden. Bitte versuche es erneut.' };
	}
	if (!outcome.ok) {
		return {
			message:
				outcome.reason === 'iban'
					? `Die Freigabe enthält das Konto ${outcome.iban} nicht. Wähle bei der Bank genau dieses Konto aus.`
					: 'Dieser Link ist nicht mehr gültig. Richte den Bankabruf unter Bank → Konten neu ein.'
		};
	}
	const connection = (await listConnections(locals.db, user.accountId)).find(
		(entry) => entry.bankAccountId === outcome.bankAccountId
	);
	if (connection) {
		// The first fetch; should it fail, the Konten tab shows why.
		await syncConnection(locals.db, auditContext(locals), connection, { force: true }).catch(
			() => undefined
		);
	}
	redirect(303, '/bank/konten?abruf=ok');
};
