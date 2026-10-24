import { asc, eq, sql } from 'drizzle-orm';
import { findHeaderRow, parseCsv, toRecords } from '../csv';
import { today, type IsoDate } from '../dates';
import { halfYearStart, type BaseRate } from '../domain/default-interest';
import type { Database } from './db';
import { chunk, rowsPerStatement, runBatch } from './db/batch';
import { baseRates, publicDataFetches } from './db/schema';

// The Basiszinssatz (§ 247 BGB), one table for all accounts. The migration seeds the values since
// 2015; a new half-year is fetched from the time series database of the Deutsche Bundesbank
// (series BBIN1.M.DE.BBK.BBKBAS2.EUR.ME, formerly BBK01.SU0115; no account needed) the first time
// a page needs it, at most every REFRESH_AFTER_MS while the Bundesbank has not published it yet.
// The Bundesbank asks to be named as the source, so the pages that show the rate do.

export const BASE_RATE_SERIES = 'BBIN1.M.DE.BBK.BBKBAS2.EUR.ME';
const FETCH_ID = 'bundesbank-base-rate';
const BUNDESBANK_URL =
	'https://api.statistiken.bundesbank.de/rest/data/BBIN1/M.DE.BBK.BBKBAS2.EUR.ME';
/** The rate is announced days before the half-year starts; four attempts a day find it in time. */
export const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

export type BaseRateFetch = typeof publicDataFetches.$inferSelect;

/** All stored rates, oldest first. */
export async function listBaseRates(db: Database): Promise<BaseRate[]> {
	return db.select().from(baseRates).orderBy(asc(baseRates.validFrom));
}

export async function lastBaseRateFetch(db: Database): Promise<BaseRateFetch | undefined> {
	const [row] = await db.select().from(publicDataFetches).where(eq(publicDataFetches.id, FETCH_ID));
	return row;
}

/**
 * The half-year rates of the CSV answer of the Bundesbank API (`Accept: text/csv`, SDMX-CSV):
 * a header with TIME_PERIOD and OBS_VALUE, comma or semicolon as separator (detected), decimal
 * points, `.` or nothing for a missing value. The period may be a month (2026-07), a day or a
 * half-year (2026-S2); only the values on 1 January and 1 July are kept, in basis points.
 */
export function parseBaseRates(text: string): BaseRate[] {
	const rows = parseCsv(text);
	const headerIndex = findHeaderRow(rows, ['TIME_PERIOD', 'OBS_VALUE']);
	if (headerIndex < 0) {
		throw new Error('Die Antwort der Bundesbank ist keine Zeitreihe im erwarteten Format.');
	}
	const rates = new Map<IsoDate, number>();
	for (const record of toRecords(rows, headerIndex)) {
		const validFrom = halfYearOf(record.TIME_PERIOD);
		const raw = record.OBS_VALUE ?? '';
		if (!validFrom || !/^-?\d+(\.\d+)?$/.test(raw)) continue;
		const rate = Math.round(Number(raw) * 100);
		if (rate < -500 || rate > 2000) {
			throw new Error(`Die Bundesbank meldet einen unplausiblen Basiszinssatz (${raw} %).`);
		}
		rates.set(validFrom, rate);
	}
	if (rates.size === 0) throw new Error('Die Zeitreihe der Bundesbank enthält keine Werte.');
	return [...rates].map(([validFrom, rate]) => ({ validFrom, rate }));
}

/** The first day of a half-year for a period that starts one: 2026-07, 2026-07-01, 2026-S2. */
function halfYearOf(period: string | undefined): IsoDate | null {
	const match = /^(\d{4})-(?:(01|07)(?:-01)?|S([12]))$/.exec(period ?? '');
	if (!match) return null;
	const [, year, month, half] = match;
	return `${year}-${month ?? (half === '1' ? '01' : '07')}-01`;
}

/** Downloads the Basiszinssatz series from the Bundesbank and returns its half-year rates. */
export async function downloadBaseRates(fetcher: typeof fetch = fetch): Promise<BaseRate[]> {
	let response: Response;
	try {
		response = await fetcher(BUNDESBANK_URL, {
			headers: { accept: 'text/csv' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (cause) {
		throw new Error('Die Bundesbank war nicht erreichbar.', { cause });
	}
	if (!response.ok) throw new Error(`Die Bundesbank antwortete mit Status ${response.status}.`);
	return parseBaseRates(await response.text());
}

/** Stores the rates, replacing the stored rate of a half-year. */
export async function storeBaseRates(db: Database, rates: readonly BaseRate[]): Promise<void> {
	await runBatch(
		db,
		chunk(rates, rowsPerStatement(baseRates)).map((group) =>
			db
				.insert(baseRates)
				.values(group)
				.onConflictDoUpdate({ target: baseRates.validFrom, set: { rate: sql`excluded.rate` } })
		)
	);
}

export type RefreshOptions = { now?: Date; fetcher?: typeof fetch };

/**
 * Fetches the rates when the half-year of `now` is missing and the last attempt is older than
 * REFRESH_AFTER_MS. The attempt is recorded first, so a failing service is not asked on every
 * page view. A failure is recorded and logged, never thrown: the stored rates stay usable.
 */
export async function refreshBaseRates(db: Database, options: RefreshOptions = {}): Promise<void> {
	const now = options.now ?? new Date();
	const wanted = halfYearStart(now.toISOString().slice(0, 10));
	const [current] = await db.select().from(baseRates).where(eq(baseRates.validFrom, wanted));
	if (current) return;
	const last = await lastBaseRateFetch(db);
	if (last && now.getTime() - last.attemptedAt.getTime() < REFRESH_AFTER_MS) return;
	await db
		.insert(publicDataFetches)
		.values({ id: FETCH_ID, attemptedAt: now })
		.onConflictDoUpdate({ target: publicDataFetches.id, set: { attemptedAt: now } });
	try {
		await storeBaseRates(db, await downloadBaseRates(options.fetcher));
		await db
			.update(publicDataFetches)
			.set({ succeededAt: now, error: null })
			.where(eq(publicDataFetches.id, FETCH_ID));
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		console.error('Basiszinssatz fetch from the Bundesbank failed', cause);
		await db
			.update(publicDataFetches)
			.set({ error: message })
			.where(eq(publicDataFetches.id, FETCH_ID));
	}
}

export type BaseRateState = {
	rates: BaseRate[];
	/** The current half-year is not stored: the interest after its start uses the rate before. */
	outdated: boolean;
	/** Why the last fetch failed, when it did. */
	error: string | null;
};

/** The rates after a refresh that is due, with whether the current half-year is known. */
export async function currentBaseRates(
	db: Database,
	date: IsoDate = today()
): Promise<BaseRateState> {
	await refreshBaseRates(db);
	const [rates, last] = await Promise.all([listBaseRates(db), lastBaseRateFetch(db)]);
	const wanted = halfYearStart(date);
	return {
		rates,
		outdated: !rates.some((rate) => rate.validFrom === wanted),
		error: last?.error ?? null
	};
}
