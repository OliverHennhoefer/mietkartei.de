import { describe, expect, it, vi } from 'vitest';
import {
	currentBaseRates,
	downloadBaseRates,
	lastBaseRateFetch,
	listBaseRates,
	parseBaseRates,
	refreshBaseRates,
	REFRESH_AFTER_MS
} from './base-rate';
import { testDatabase } from './testing';

const csv = [
	'BBK_ID;TIME_PERIOD;OBS_VALUE;BBK_OBS_STATUS',
	'BBK01.SU0115;2026-05;1.27;A',
	'BBK01.SU0115;2026-06;1.27;A',
	'BBK01.SU0115;2026-07;1.52;A',
	'BBK01.SU0115;2027-01;1.77;A',
	'BBK01.SU0115;2027-02;.;'
].join('\r\n');

const answer = (body: string, status = 200) =>
	vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe('parseBaseRates', () => {
	it('keeps the values of 1 January and 1 July in basis points', () => {
		expect(parseBaseRates(csv)).toEqual([
			{ validFrom: '2026-07-01', rate: 152 },
			{ validFrom: '2027-01-01', rate: 177 }
		]);
	});

	it('reads days, half-years, quotes and negative rates', () => {
		const text = '"TIME_PERIOD";"OBS_VALUE"\n"2022-07-01";"-0.88"\n2023-S1;1.62\n2023-02-01;1.62';
		expect(parseBaseRates(text)).toEqual([
			{ validFrom: '2022-07-01', rate: -88 },
			{ validFrom: '2023-01-01', rate: 162 }
		]);
	});

	it('refuses an answer without the columns, without values or with an absurd rate', () => {
		expect(() => parseBaseRates('<html>Wartung</html>')).toThrow('erwarteten Format');
		expect(() => parseBaseRates('TIME_PERIOD;OBS_VALUE\n2026-05;1.27')).toThrow('keine Werte');
		expect(() => parseBaseRates('TIME_PERIOD;OBS_VALUE\n2026-07;152')).toThrow('unplausiblen');
	});
});

describe('downloadBaseRates', () => {
	it('asks for CSV and reports HTTP and network errors', async () => {
		const fetcher = answer(csv);
		expect(await downloadBaseRates(fetcher)).toHaveLength(2);
		expect(fetcher).toHaveBeenCalledWith(
			'https://api.statistiken.bundesbank.de/rest/data/BBK01/SU0115',
			expect.objectContaining({ headers: { accept: 'text/csv' } })
		);
		await expect(downloadBaseRates(answer('', 503))).rejects.toThrow('Status 503');
		const offline = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch;
		await expect(downloadBaseRates(offline)).rejects.toThrow('nicht erreichbar');
	});
});

describe('refreshBaseRates', () => {
	it('starts with the seeded rates and asks nobody while the half-year is known', async () => {
		const db = await testDatabase();
		const rates = await listBaseRates(db);
		expect(rates[0]).toEqual({ validFrom: '2015-01-01', rate: -83 });
		expect(rates.at(-1)).toEqual({ validFrom: '2026-07-01', rate: 152 });
		const fetcher = answer(csv);
		await refreshBaseRates(db, { now: new Date('2026-10-24T12:00:00Z'), fetcher });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('fetches a missing half-year, at most every few hours while it fails', async () => {
		const db = await testDatabase();
		const now = new Date('2027-01-02T08:00:00Z');
		const failing = answer('', 500);
		await refreshBaseRates(db, { now, fetcher: failing });
		await refreshBaseRates(db, { now: new Date(now.getTime() + 1000), fetcher: failing });
		expect(failing).toHaveBeenCalledTimes(1);
		expect(await lastBaseRateFetch(db)).toMatchObject({ error: expect.stringContaining('500') });

		const later = new Date(now.getTime() + REFRESH_AFTER_MS + 1);
		await refreshBaseRates(db, { now: later, fetcher: answer(csv) });
		expect((await listBaseRates(db)).at(-1)).toEqual({ validFrom: '2027-01-01', rate: 177 });
		expect(await lastBaseRateFetch(db)).toMatchObject({ error: null, succeededAt: later });
	});

	it('says when the current half-year is missing', async () => {
		const db = await testDatabase();
		expect(await currentBaseRates(db, '2026-10-24')).toMatchObject({
			outdated: false,
			error: null
		});
		expect((await currentBaseRates(db, '2030-01-15')).outdated).toBe(true);
	});
});
