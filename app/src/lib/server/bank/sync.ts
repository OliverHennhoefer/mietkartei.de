import { and, asc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { formatIban } from '../../domain/bank-matching';
import { addDays, dayOf } from '../../dates';
import { auditEntry, type AuditContext } from '../audit';
import type { Database } from '../db';
import { runBatch } from '../db/batch';
import { bankAccounts, bankConnections } from '../db/schema';
import { getBankAccount } from './accounts';
import {
	bankSyncEnabled,
	createSession,
	deleteSession,
	listTransactions,
	startAuthorization,
	toRow,
	type Aspsp
} from './enable-banking';
import { commitImport, previewImport } from './imports';

// Bankabruf: instead of downloading a statement and importing it, the landlord authorizes
// Enable Banking once at the bank, and the app fetches the booked transactions itself. Like the
// Verbraucherpreisindex there is no scheduled job: opening the Umsätze fetches what is new, at
// most every six hours per bank account, and the button on the Konten tab fetches at once. The
// transactions go through the same import as a file, so duplicates, rules and suggestions work
// the same.

export type BankConnection = typeof bankConnections.$inferSelect;

export const SYNC_AFTER_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back the first fetch goes; most banks allow 90 days without a new authorization. */
const FIRST_FETCH_DAYS = 89;
/** Later fetches overlap the last one, so a booking the bank adds late is not missed. */
const OVERLAP_DAYS = 14;
const DEFAULT_CONSENT_DAYS = 90;
const MAX_CONSENT_DAYS = 180;

export async function listConnections(db: Database, accountId: string): Promise<BankConnection[]> {
	return db
		.select()
		.from(bankConnections)
		.where(eq(bankConnections.accountId, accountId))
		.orderBy(asc(bankConnections.createdAt));
}

/** Whether a connection may fetch at `now`: authorized and not expired. */
export function connectionActive(connection: BankConnection, now: Date): boolean {
	return Boolean(
		connection.sessionId &&
		connection.accountUid &&
		connection.validUntil &&
		connection.validUntil > now
	);
}

function randomState(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Starts the authorization of a bank account at its bank and returns where to send the
 * landlord. A renewal keeps the running session until the new one arrives.
 */
export async function startConnection(
	db: Database,
	context: AuditContext,
	bankAccountId: string,
	aspsp: Aspsp,
	origin: string,
	now = new Date()
): Promise<{ url: string } | undefined> {
	const bankAccount = await getBankAccount(db, context.accountId, bankAccountId);
	if (!bankAccount) return undefined;
	const days = Math.min(
		MAX_CONSENT_DAYS,
		aspsp.maximum_consent_validity
			? Math.floor(aspsp.maximum_consent_validity / 86_400)
			: DEFAULT_CONSENT_DAYS
	);
	const state = randomState();
	const { url } = await startAuthorization({
		aspsp: { name: aspsp.name, country: aspsp.country },
		validUntil: new Date(now.getTime() + days * DAY_MS),
		state,
		redirectUrl: `${origin}/bank/abruf`
	});
	await db
		.insert(bankConnections)
		.values({
			accountId: context.accountId,
			bankAccountId,
			aspspName: aspsp.name,
			aspspCountry: aspsp.country,
			state
		})
		.onConflictDoUpdate({
			target: bankConnections.bankAccountId,
			set: { aspspName: aspsp.name, aspspCountry: aspsp.country, state }
		});
	return { url };
}

export type FinishOutcome =
	{ ok: true; bankAccountId: string } | { ok: false; reason: 'unknown' | 'iban'; iban?: string };

/**
 * Takes the code of the bank's redirect: opens the session, finds the bank account in it by IBAN
 * and stores both. A session without that IBAN is ended again, since it is of no use.
 */
export async function finishConnection(
	db: Database,
	context: AuditContext,
	state: string,
	code: string
): Promise<FinishOutcome> {
	const [connection] = await db
		.select({ connection: bankConnections, iban: bankAccounts.iban, name: bankAccounts.name })
		.from(bankConnections)
		.innerJoin(bankAccounts, eq(bankAccounts.id, bankConnections.bankAccountId))
		.where(and(eq(bankConnections.accountId, context.accountId), eq(bankConnections.state, state)));
	if (!connection) return { ok: false, reason: 'unknown' };
	const session = await createSession(code);
	const account = session.accounts?.find(
		(entry) => entry.account_id?.iban?.replace(/\s+/g, '').toUpperCase() === connection.iban
	);
	if (!account) {
		await deleteSession(session.session_id).catch(() => undefined);
		return { ok: false, reason: 'iban', iban: formatIban(connection.iban) };
	}
	const previous = connection.connection.sessionId;
	const validUntil = session.access?.valid_until ? new Date(session.access.valid_until) : null;
	await runBatch(db, [
		db
			.update(bankConnections)
			.set({
				state: null,
				sessionId: session.session_id,
				accountUid: account.uid,
				validUntil,
				lastError: null
			})
			.where(eq(bankConnections.id, connection.connection.id)),
		auditEntry(
			db,
			context,
			'bankAccount',
			connection.connection.bankAccountId,
			'update',
			`Bankabruf für „${connection.name}“ bei ${connection.connection.aspspName} eingerichtet`
		)
	]);
	if (previous && previous !== session.session_id) {
		await deleteSession(previous).catch(() => undefined);
	}
	return { ok: true, bankAccountId: connection.connection.bankAccountId };
}

export type SyncResult = { imported: number; assigned: number };

/**
 * Fetches the transactions of one connection and imports what is new. The fetch is claimed by
 * moving lastSyncedAt first, so two page loads at once fetch once; with `force` the six hours do
 * not count. Undefined when another request claimed it or the connection cannot fetch. A failure
 * is kept in lastError and thrown.
 */
export async function syncConnection(
	db: Database,
	context: AuditContext,
	connection: BankConnection,
	options: { now?: Date; force?: boolean } = {}
): Promise<SyncResult | undefined> {
	const now = options.now ?? new Date();
	if (!bankSyncEnabled() || !connectionActive(connection, now)) return undefined;
	const due = new Date(now.getTime() - SYNC_AFTER_MS);
	const claimed = await db
		.update(bankConnections)
		.set({ lastSyncedAt: now })
		.where(
			and(
				eq(bankConnections.id, connection.id),
				options.force
					? undefined
					: or(isNull(bankConnections.lastSyncedAt), lt(bankConnections.lastSyncedAt, due))
			)
		)
		.returning({ id: bankConnections.id });
	if (claimed.length === 0) return undefined;

	const from = connection.lastSyncedAt
		? addDays(dayOf(connection.lastSyncedAt), -OVERLAP_DAYS)
		: addDays(dayOf(now), -FIRST_FETCH_DAYS);
	try {
		const results = (await listTransactions(connection.accountUid!, from)).map(toRow);
		const preview = await previewImport(db, context.accountId, connection.bankAccountId, results);
		let outcome: SyncResult = { imported: 0, assigned: 0 };
		if (preview && preview.counts.new + preview.counts.rules > 0) {
			const result = await commitImport(
				db,
				context,
				connection.bankAccountId,
				`Bankabruf ${connection.aspspName}`,
				results
			);
			if (result) outcome = { imported: result.imported, assigned: result.assigned };
		}
		await db
			.update(bankConnections)
			.set({ lastError: null })
			.where(eq(bankConnections.id, connection.id));
		return outcome;
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		await db
			.update(bankConnections)
			.set({ lastError: message.slice(0, 500) })
			.where(eq(bankConnections.id, connection.id));
		throw cause;
	}
}

/**
 * Fetches every connection of the account whose last fetch is older than six hours. Failures
 * stay on the connection for the Konten tab and never break the page that asked.
 */
export async function syncDue(db: Database, context: AuditContext, now = new Date()) {
	if (!bankSyncEnabled()) return;
	const due = new Date(now.getTime() - SYNC_AFTER_MS);
	const connections = await db
		.select()
		.from(bankConnections)
		.where(
			and(
				eq(bankConnections.accountId, context.accountId),
				isNotNull(bankConnections.sessionId),
				or(isNull(bankConnections.lastSyncedAt), lt(bankConnections.lastSyncedAt, due))
			)
		);
	for (const connection of connections) {
		try {
			await syncConnection(db, context, connection, { now });
		} catch (cause) {
			console.warn(`Bankabruf failed: ${cause instanceof Error ? cause.message : cause}`);
		}
	}
}

/** Ends the Bankabruf of a bank account: the session at the bank first, then the row. */
export async function endConnection(
	db: Database,
	context: AuditContext,
	bankAccountId: string
): Promise<boolean> {
	const [connection] = await db
		.select()
		.from(bankConnections)
		.where(
			and(
				eq(bankConnections.accountId, context.accountId),
				eq(bankConnections.bankAccountId, bankAccountId)
			)
		);
	if (!connection) return false;
	if (connection.sessionId) await deleteSession(connection.sessionId).catch(() => undefined);
	await runBatch(db, [
		db.delete(bankConnections).where(eq(bankConnections.id, connection.id)),
		auditEntry(
			db,
			context,
			'bankAccount',
			bankAccountId,
			'update',
			`Bankabruf bei ${connection.aspspName} beendet`
		)
	]);
	return true;
}
