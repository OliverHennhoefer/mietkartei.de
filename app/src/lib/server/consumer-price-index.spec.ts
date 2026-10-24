import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './db';
import { consumerPriceIndex, consumerPriceIndexFetches } from './db/schema';
import {
	downloadIndexValues,
	indexFetchRunning,
	lastIndexFetch,
	listIndexValues,
	parseGenesisTable,
	REFRESH_AFTER_MS,
	RETRY_AFTER_MS,
	refreshIndexValues
} from './consumer-price-index';
import { testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

const header =
	'statistics_code;statistics_label;time_code;time_label;time;1_variable_code;1_variable_label;' +
	'1_variable_attribute_code;1_variable_attribute_label;2_variable_code;2_variable_label;' +
	'2_variable_attribute_code;2_variable_attribute_label;value;value_unit;value_variable_code;' +
	'value_variable_label;value_q';

function row(
	year: string,
	month: string,
	value: string,
	measure = 'PREIS1',
	unit = '2020=100',
	label = 'Verbraucherpreisindex'
) {
	return (
		`61111;Verbraucherpreisindex für Deutschland;JAHR;Jahr;${year};DINSG;Deutschland insgesamt;` +
		`DG;Deutschland;MONAT;Monate;MONAT${month};Monat ${month};${value};${unit};${measure};` +
		`${label};e`
	);
}

// A part of table 61111-0002: the index, its rates of change under the same measure code (one of
// them 0,0 without a sign, one not marked as a rate at all), another measure and a month not
// published yet.
const table = [
	header,
	row('2025', '12', '122,7'),
	row('2025', '12', '0,0', 'PREIS1', 'Prozent', 'Veränderung zum Vorjahresmonat'),
	row('2025', '12', '+0,3', 'PREIS1', '%', 'Veränderung zum Vormonat'),
	row('2025', '12', '2,1', 'PREIS1', '2020=100', 'Verbraucherpreisindex'),
	row('2025', '12', '2,6', 'PREIS2'),
	row('2026', '01', '122,8'),
	row('2026', '02', '...'),
	''
].join('\r\n');

describe('parseGenesisTable', () => {
	it('takes the index of each published month', () => {
		expect(parseGenesisTable(table)).toEqual([
			{ month: '2025-12', value: 122.7 },
			{ month: '2026-01', value: 122.8 }
		]);
	});

	it('refuses another format, a table without months and two values for a month', () => {
		expect(() => parseGenesisTable('<html></html>')).toThrow('erwarteten Format');
		expect(() => parseGenesisTable(`${header}\n${row('2026', '01', '122,8', 'X')}`)).toThrow(
			'keine Indexwerte'
		);
		expect(() =>
			parseGenesisTable(`${header}\n${row('2026', '01', '1').replaceAll('MONAT', 'QUARTAL')}`)
		).toThrow('keine Monate');
		expect(() =>
			parseGenesisTable(`${header}\n${row('2026', '01', '122,8')}\n${row('2026', '01', '121,0')}`)
		).toThrow('mehrere Werte: 122,8 2020=100 Verbraucherpreisindex und 121,0 2020=100');
	});
});

describe('downloadIndexValues', () => {
	it('posts the table request with the token in the username header and unzips the answer', async () => {
		const archive = zipSync({ '61111-0002_flat.csv': strToU8(table) });
		const fetcher = vi.fn(async () => new Response(archive));
		expect(await downloadIndexValues('token', fetcher)).toHaveLength(2);
		const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://genesis.destatis.de/genesisWS/rest/2020/data/tablefile');
		expect(init.headers).toMatchObject({ username: 'token' });
		const body = init.body as URLSearchParams;
		expect(body.get('name')).toBe('61111-0002');
		expect(body.get('format')).toBe('ffcsv');
	});

	it('names the status Destatis answers with', async () => {
		const status = { Status: { Code: 98, Content: 'Fehler bei der Anmeldung.' } };
		await expect(downloadIndexValues('token', async () => Response.json(status))).rejects.toThrow(
			'Destatis meldet: Fehler bei der Anmeldung.'
		);
		await expect(
			downloadIndexValues('token', async () => new Response('', { status: 503 }))
		).rejects.toThrow('Status 503');
		await expect(
			downloadIndexValues('token', async () => new Response(strToU8('PK\u0003\u0004kaputt')))
		).rejects.toThrow('Das Archiv von Destatis ist beschädigt.');
		await expect(
			downloadIndexValues('token', async () => {
				throw new TypeError('fetch failed');
			})
		).rejects.toThrow('Destatis war nicht erreichbar.');
	});
});

describe('refreshIndexValues', () => {
	const now = new Date('2026-10-24T12:00:00Z');
	const later = (ms: number) => new Date(now.getTime() + ms);

	it('fetches nothing without a token', async () => {
		const fetcher = vi.fn();
		await refreshIndexValues(db, { token: '', now, fetcher });
		expect(fetcher).not.toHaveBeenCalled();
		expect(await lastIndexFetch(db)).toBeUndefined();
	});

	it('stores the values, replaces a corrected one and waits before asking again', async () => {
		await db
			.insert(consumerPriceIndex)
			.values({ month: '2025-12', value: 122.5, baseYear: '2020' });
		const fetcher = vi.fn(async () => new Response(table));
		await refreshIndexValues(db, { token: 't', now, fetcher });
		expect(await listIndexValues(db)).toEqual([
			{ month: '2026-01', value: 122.8, baseYear: '2020' },
			{ month: '2025-12', value: 122.7, baseYear: '2020' }
		]);
		expect(await lastIndexFetch(db)).toMatchObject({ succeededAt: now, error: null });

		await refreshIndexValues(db, { token: 't', now: later(REFRESH_AFTER_MS - 1), fetcher });
		expect(fetcher).toHaveBeenCalledTimes(1);
		await refreshIndexValues(db, { token: 't', now: later(REFRESH_AFTER_MS), fetcher });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('records a failure and keeps the stored values', async () => {
		await db
			.insert(consumerPriceIndex)
			.values({ month: '2025-12', value: 122.7, baseYear: '2020' });
		await refreshIndexValues(db, {
			token: 't',
			now,
			fetcher: async () => new Response('', { status: 500 })
		});
		expect(await lastIndexFetch(db)).toMatchObject({
			attemptedAt: now,
			succeededAt: null,
			error: 'Destatis antwortete mit Status 500.'
		});
		expect(await listIndexValues(db)).toHaveLength(1);

		// An attempt that never ends (cancelled with the request) says so instead of keeping the
		// earlier error.
		void refreshIndexValues(db, {
			token: 't',
			now: later(RETRY_AFTER_MS),
			fetcher: () => new Promise<Response>(() => {})
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const waiting = await lastIndexFetch(db);
		expect(waiting).toMatchObject({
			attemptedAt: later(RETRY_AFTER_MS),
			error: expect.stringContaining('auf die Antwort von Destatis wartete')
		});
		expect(indexFetchRunning(waiting, later(RETRY_AFTER_MS + 59_000))).toBe(true);
		expect(indexFetchRunning(waiting, later(RETRY_AFTER_MS + 60_000))).toBe(false);

		// One that stops while the table arrives names that step.
		await db.update(consumerPriceIndexFetches).set({ attemptedAt: now, error: 'x' });
		void refreshIndexValues(db, {
			token: 't',
			now: later(RETRY_AFTER_MS),
			fetcher: async () =>
				({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) }) as Response
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await lastIndexFetch(db)).toMatchObject({
			error: expect.stringContaining('die Tabelle von Destatis las')
		});
		expect(indexFetchRunning({ ...waiting!, error: 'Destatis antwortete mit Status 500.' })).toBe(
			false
		);
		await db.update(consumerPriceIndexFetches).set({ attemptedAt: now, error: 'x' });

		// A failure is tried again after half an hour, not after six.
		const early = vi.fn();
		await refreshIndexValues(db, { token: 't', now: later(RETRY_AFTER_MS - 1), fetcher: early });
		expect(early).not.toHaveBeenCalled();
		await refreshIndexValues(db, {
			token: 't',
			now: later(RETRY_AFTER_MS),
			fetcher: async () => new Response(table)
		});
		expect(await lastIndexFetch(db)).toMatchObject({
			succeededAt: later(RETRY_AFTER_MS),
			error: null
		});
	});
});
