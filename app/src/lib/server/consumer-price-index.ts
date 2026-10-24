import { desc, eq, sql } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { GENESIS_API_TOKEN } from '$app/env/private';
import type { IsoMonth } from '../dates';
import type { IndexPoint, IndexValueRow } from '../domain/index-rent';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import { consumerPriceIndex, consumerPriceIndexFetches } from './db/schema';

// The Verbraucherpreisindex for Germany, one table for all accounts. It is fetched from the
// GENESIS web service of Destatis (table 61111-0002, base year 2020 = 100) in the background when
// a page that needs it is opened and the last attempt is older than REFRESH_AFTER_MS. The service needs the API
// token of a (free) GENESIS account; without GENESIS_API_TOKEN nothing is fetched. Destatis
// publishes the data under the Datenlizenz Deutschland – Namensnennung – Version 2.0, so the
// pages that show values name the source.

export const GENESIS_TABLE = '61111-0002';
export const INDEX_BASE_YEAR = '2020';
/** The first year of the 2020-based series. */
const FIRST_YEAR = 1991;
const FETCH_ID = 'destatis';
/** Smaller values are rates of change, should one come without a unit or label saying so. */
const MIN_INDEX_VALUE = 20;
/**
 * While an attempt runs, its record names the step it is in, worded as if the attempt stopped
 * there: an attempt the platform cancels never reaches its catch and leaves this message behind.
 */
const STAGES = {
	waiting: 'Der Abruf wurde abgebrochen, während Mietkartei auf die Antwort von Destatis wartete.',
	reading: 'Der Abruf wurde abgebrochen, während Mietkartei die Tabelle von Destatis las.',
	storing: 'Der Abruf wurde abgebrochen, während Mietkartei die Werte speicherte.'
} as const;
/** An attempt still in one of its STAGES after this long was cancelled. */
const RUNNING_FOR_MS = 60_000;
/** Destatis publishes once a month; four attempts a day find a new value within hours. */
export const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
/** A failed attempt is repeated sooner, so a fix on either side shows within the hour. */
export const RETRY_AFTER_MS = 30 * 60 * 1000;
/** Leaves room within the 30 seconds a Worker may keep working after its response. */
const TIMEOUT_MS = 25_000;
const GENESIS_URL = 'https://genesis.destatis.de/genesisWS/rest/2020/data/tablefile';

export type IndexFetch = typeof consumerPriceIndexFetches.$inferSelect;

/** All VPI values, newest month first. */
export async function listIndexValues(db: Database): Promise<IndexValueRow[]> {
	return db
		.select()
		.from(consumerPriceIndex)
		.orderBy(desc(consumerPriceIndex.month), desc(consumerPriceIndex.baseYear));
}

export async function lastIndexFetch(db: Database): Promise<IndexFetch | undefined> {
	const [row] = await db
		.select()
		.from(consumerPriceIndexFetches)
		.where(eq(consumerPriceIndexFetches.id, FETCH_ID));
	return row;
}

function cell(value: string | undefined): string {
	return (value ?? '').trim().replace(/^"(.*)"$/, '$1');
}

/**
 * The monthly index values of a GENESIS "flat file CSV" (ffcsv) of table 61111-0002: one row per
 * year, month and measure, separated by semicolons, with decimal commas and `...` for values not
 * published yet. Only the index itself (measure PREIS1) is taken. The rates of change to the
 * previous month and year come with the same measure code, but in percent: they are told apart by
 * their unit or label (and carry a sign, `+0,3`, except for `0,0`).
 */
export function parseGenesisTable(text: string): IndexPoint[] {
	const lines = text.split(/\r?\n/).filter((line) => line.trim());
	const header = (lines[0] ?? '').split(';').map(cell);
	const timeColumn = header.indexOf('time');
	const valueColumn = header.indexOf('value');
	const measureColumn = header.indexOf('value_variable_code');
	const unitColumn = header.indexOf('value_unit');
	const labelColumn = header.indexOf('value_variable_label');
	if (timeColumn < 0 || valueColumn < 0) {
		throw new Error('Die Antwort von Destatis ist keine Tabelle im erwarteten Format.');
	}
	const rows = lines.slice(1).map((line) => line.split(';').map(cell));
	// The month is one of the numbered variables (n_variable_code = MONAT).
	const monthColumn = header.findIndex((name, column) => {
		const variable = /^(\d+)_variable_code$/.exec(name);
		return variable && rows.some((row) => row[column] === 'MONAT');
	});
	if (monthColumn < 0) throw new Error('Die Tabelle von Destatis enthält keine Monate.');
	const attributeColumn = header.indexOf(
		header[monthColumn].replace('_variable_code', '_variable_attribute_code')
	);

	const isRate = (row: string[]) =>
		/%|prozent|veränderung/i.test(`${row[unitColumn] ?? ''} ${row[labelColumn] ?? ''}`);
	const describe = (row: string[]) =>
		[row[valueColumn], row[unitColumn], row[labelColumn]].filter(Boolean).join(' ');

	const values = new Map<IsoMonth, { value: number; row: string[] }>();
	for (const row of rows) {
		if (measureColumn >= 0 && row[measureColumn] !== 'PREIS1') continue;
		if (isRate(row)) continue;
		const year = row[timeColumn];
		const month = /^MONAT(\d{2})$/.exec(row[attributeColumn] ?? '')?.[1];
		const raw = row[valueColumn];
		if (!/^\d{4}$/.test(year) || !month || !/^\d+(,\d+)?$/.test(raw)) continue;
		const value = Number(raw.replace(',', '.'));
		// The 2020-based index never fell below 60; a rate of change never reached 20 percent.
		if (value < MIN_INDEX_VALUE) continue;
		const key = `${year}-${month}`;
		const other = values.get(key);
		if (other && other.value !== value) {
			throw new Error(
				`Die Tabelle von Destatis enthält für ${key} mehrere Werte: ` +
					`${describe(other.row)} und ${describe(row)}.`
			);
		}
		values.set(key, { value, row });
	}
	if (values.size === 0) throw new Error('Die Tabelle von Destatis enthält keine Indexwerte.');
	return [...values].map(([month, { value }]) => ({ month, value }));
}

/**
 * The text of a GENESIS answer: a table download comes as a ZIP archive with one CSV file, an
 * error as plain JSON. Only codes and numbers are read, so the encoding of labels does not matter.
 */
function genesisText(bytes: Uint8Array): string {
	const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
	if (!zipped) return strFromU8(bytes);
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch (cause) {
		throw new Error('Das Archiv von Destatis ist beschädigt.', { cause });
	}
	const [csv] = Object.values(files);
	if (!csv) throw new Error('Das Archiv von Destatis ist leer.');
	return strFromU8(csv);
}

/** Downloads table 61111-0002 from GENESIS with the API token and returns its index values. */
export async function downloadIndexValues(
	token: string,
	fetcher: typeof fetch = fetch,
	onResponse: () => Promise<void> = async () => {}
): Promise<IndexPoint[]> {
	let response: Response;
	try {
		response = await fetcher(GENESIS_URL, {
			method: 'POST',
			// The token goes in the username header; a token needs no password.
			headers: { username: token, 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				name: GENESIS_TABLE,
				area: 'all',
				compress: 'false',
				transpose: 'false',
				startyear: String(FIRST_YEAR),
				format: 'ffcsv',
				language: 'de'
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (cause) {
		throw new Error('Destatis war nicht erreichbar.', { cause });
	}
	await onResponse();
	const text = genesisText(new Uint8Array(await response.arrayBuffer()));
	if (!response.ok) throw new Error(`Destatis antwortete mit Status ${response.status}.`);
	// Errors (a wrong token, a table that must be ordered as a job) come as JSON with a status.
	if (text.trimStart().startsWith('{')) {
		let message: unknown;
		try {
			message = (JSON.parse(text) as { Status?: { Content?: unknown } }).Status?.Content;
		} catch {
			message = undefined;
		}
		throw new Error(
			typeof message === 'string' && message
				? `Destatis meldet: ${message}`
				: 'Destatis antwortete ohne Tabelle.'
		);
	}
	return parseGenesisTable(text);
}

/** Stores the values of base year 2020, replacing the stored value of a month. */
export async function storeIndexValues(db: Database, values: readonly IndexPoint[]): Promise<void> {
	const rows = values.map((value) => ({ ...value, baseYear: INDEX_BASE_YEAR }));
	await runBatch(
		db,
		chunk(rows, rowsPerStatement(consumerPriceIndex)).map((group) =>
			db
				.insert(consumerPriceIndex)
				.values(group)
				.onConflictDoUpdate({
					target: [consumerPriceIndex.baseYear, consumerPriceIndex.month],
					set: { value: sql`excluded.value` }
				})
		)
	);
}

export type RefreshOptions = { token: string; now?: Date; fetcher?: typeof fetch };

/** Whether an attempt is under way: it is in one of its STAGES and not older than a minute. */
export function indexFetchRunning(fetch: IndexFetch | undefined, now = new Date()): boolean {
	return (
		!!fetch?.error &&
		Object.values<string>(STAGES).includes(fetch.error) &&
		now.getTime() - fetch.attemptedAt.getTime() < RUNNING_FOR_MS
	);
}

/**
 * Records an attempt when there is a token and the last attempt is older than REFRESH_AFTER_MS,
 * or RETRY_AFTER_MS after a failure, and returns the attempt to run. Recording it first keeps a
 * failing service from being asked on every page view.
 */
async function claimRefresh(
	db: Database,
	options: RefreshOptions
): Promise<(() => Promise<void>) | undefined> {
	if (!options.token) return undefined;
	const now = options.now ?? new Date();
	const last = await lastIndexFetch(db);
	const wait = last?.error ? RETRY_AFTER_MS : REFRESH_AFTER_MS;
	if (last && now.getTime() - last.attemptedAt.getTime() < wait) return undefined;
	const claim = { attemptedAt: now, error: STAGES.waiting };
	await db
		.insert(consumerPriceIndexFetches)
		.values({ id: FETCH_ID, ...claim })
		.onConflictDoUpdate({ target: consumerPriceIndexFetches.id, set: claim });

	const record = async (values: Partial<IndexFetch>) => {
		await db
			.update(consumerPriceIndexFetches)
			.set(values)
			.where(eq(consumerPriceIndexFetches.id, FETCH_ID));
	};
	return async () => {
		try {
			const values = await downloadIndexValues(options.token, options.fetcher, () =>
				record({ error: STAGES.reading })
			);
			await record({ error: STAGES.storing });
			await storeIndexValues(db, values);
			await record({ succeededAt: now, error: null });
		} catch (cause) {
			console.error('VPI fetch from Destatis failed', cause);
			await record({ error: cause instanceof Error ? cause.message : String(cause) });
		}
	};
}

/**
 * Fetches the values again when that is due (see claimRefresh). A failure is recorded and logged,
 * never thrown: the stored values stay usable.
 */
export async function refreshIndexValues(db: Database, options: RefreshOptions): Promise<void> {
	await (
		await claimRefresh(db, options)
	)?.();
}

/** Whether this instance fetches the values (GENESIS_API_TOKEN is set). */
export const indexFetchConfigured = Boolean(GENESIS_API_TOKEN);

/**
 * The stored VPI values, newest month first. A refresh that is due runs in the background: the
 * page does not wait for Destatis, and the attempt does not end when the page is sent or the
 * visitor leaves. It shows on a later visit.
 */
export async function currentIndexValues(db: Database): Promise<IndexValueRow[]> {
	const run = await claimRefresh(db, { token: GENESIS_API_TOKEN });
	if (run) {
		const running = run().catch((cause) => console.error('VPI fetch from Destatis failed', cause));
		if (__DEPLOY_TARGET__ === 'cloudflare') {
			const { waitUntil } = await import('cloudflare:workers');
			waitUntil(running);
		}
	}
	return listIndexValues(db);
}
