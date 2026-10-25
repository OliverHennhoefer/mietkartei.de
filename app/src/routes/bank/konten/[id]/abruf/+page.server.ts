import { error, fail, redirect } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import { formatIban } from '#lib/domain/bank-matching.ts';
import { getBankAccount } from '#lib/server/bank/accounts.ts';
import { bankOfIban } from '#lib/server/bank/bank-codes.ts';
import {
	bankSyncEnabled,
	EnableBankingError,
	listAspsps,
	type Aspsp
} from '#lib/server/bank/enable-banking.ts';
import { startConnection } from '#lib/server/bank/sync.ts';
import { mailLinkOrigin } from '#lib/server/mail-links.ts';
import { auditContext, requireOwner } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Setting up the Bankabruf of one bank account: the landlord picks the bank, and the app sends
// them there to authorize the access. The bank sends them back to /bank/abruf.

const BANKS_DOWN =
	'Die Liste der Banken ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.';

/** The bank of the account in the list: by BIC, else by the name the Bundesbank gives. */
function preselect(aspsps: readonly Aspsp[], iban: string, bic: string | null): string | null {
	const code = (bic ?? bankOfIban(iban)?.bic ?? '').slice(0, 8).toUpperCase();
	const byBic = code
		? aspsps.find((aspsp) => aspsp.bic?.slice(0, 8).toUpperCase() === code)
		: undefined;
	if (byBic) return byBic.name;
	const name = bankOfIban(iban)?.name.toLowerCase();
	return (name && aspsps.find((aspsp) => name.startsWith(aspsp.name.toLowerCase()))?.name) || null;
}

async function bankAccountOf(locals: App.Locals, id: string) {
	if (!bankSyncEnabled()) error(404, 'Auf dieser Instanz gibt es keinen Bankabruf.');
	const user = requireOwner(locals);
	const bankAccount = await getBankAccount(locals.db, user.accountId, id);
	if (!bankAccount) error(404, 'Diese Bankverbindung gibt es nicht.');
	return bankAccount;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const bankAccount = await bankAccountOf(locals, params.id);
	let aspsps: Aspsp[] = [];
	let unavailable = false;
	try {
		aspsps = (await listAspsps()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
	} catch (cause) {
		if (!(cause instanceof EnableBankingError)) throw cause;
		console.error(cause.message);
		unavailable = true;
	}
	return {
		bankAccount: { id: bankAccount.id, name: bankAccount.name, iban: formatIban(bankAccount.iban) },
		banks: aspsps.map((aspsp) => aspsp.name),
		selected: preselect(aspsps, bankAccount.iban, bankAccount.bic),
		unavailable
	};
};

export const actions: Actions = {
	start: async ({ locals, params, request, url }) => {
		const bankAccount = await bankAccountOf(locals, params.id);
		const name = String((await request.formData()).get('bank') ?? '');
		const origin = mailLinkOrigin(url, ORIGIN, __DEPLOY_TARGET__);
		if (!origin) {
			return fail(503, {
				message:
					'Wer mietkartei betreibt, muss für den Bankabruf ORIGIN auf die öffentliche Adresse setzen.'
			});
		}
		let location: string;
		try {
			const aspsp = (await listAspsps()).find((entry) => entry.name === name);
			if (!aspsp) return fail(400, { message: 'Wähle deine Bank aus der Liste.' });
			const started = await startConnection(
				locals.db,
				auditContext(locals),
				bankAccount.id,
				aspsp,
				origin
			);
			if (!started) error(404, 'Diese Bankverbindung gibt es nicht.');
			location = started.url;
		} catch (cause) {
			if (!(cause instanceof EnableBankingError)) throw cause;
			console.error(cause.message);
			return fail(502, { message: BANKS_DOWN });
		}
		let target: URL;
		try {
			target = new URL(location);
		} catch {
			return fail(502, { message: BANKS_DOWN });
		}
		if (target.protocol !== 'https:') return fail(502, { message: BANKS_DOWN });
		redirect(303, target.href, { external: [target.origin] });
	}
};
