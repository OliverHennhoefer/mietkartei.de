import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { setDeadlineMail } from '#lib/server/deadline-mails.ts';
import { tasks } from '#lib/server/db/schema.ts';
import { isJobRequest } from '#lib/server/jobs.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { POST } from './+server';

const env = vi.hoisted(() => ({
	DEMO: false,
	MAIL_TRANSPORT: 'outbox',
	MAIL_API_KEY: '',
	MAIL_FROM: ''
}));
vi.mock('$app/env/private', () => env);

const globals = globalThis as Record<string, unknown>;
const token = 'f'.repeat(64);
let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

afterEach(() => {
	delete globals.__mietkartei_job_token;
	env.DEMO = false;
	vi.useRealTimers();
});

function post(authorization?: string) {
	const event = routeEvent(db, { user: null, url: '/api/jobs' }) as { request: Request };
	event.request = new Request('http://localhost/api/jobs', {
		method: 'POST',
		headers: authorization ? { authorization } : {}
	});
	return outcome(() => POST(event as never));
}

describe('isJobRequest', () => {
	it('takes only the token the process put into globalThis', () => {
		const request = (authorization: string) =>
			new Request('http://localhost/api/jobs', { headers: { authorization } });
		expect(isJobRequest(request(`Bearer ${token}`))).toBe(false);
		globals.__mietkartei_job_token = 'short';
		expect(isJobRequest(request('Bearer short'))).toBe(false);
		globals.__mietkartei_job_token = token;
		expect(isJobRequest(request(`Bearer ${token}`))).toBe(true);
		expect(isJobRequest(request(`Bearer ${'e'.repeat(64)}`))).toBe(false);
		expect(isJobRequest(new Request('http://localhost/api/jobs'))).toBe(false);
	});
});

describe('POST /api/jobs', () => {
	it('answers 404 without the token and runs the jobs with it', async () => {
		expect(await post()).toMatchObject({ error: 404 });
		globals.__mietkartei_job_token = token;
		expect(await post('Bearer wrong')).toMatchObject({ error: 404 });
		await setDeadlineMail(db, 'user-a', 'https://app.example.org');
		await db
			.insert(tasks)
			.values({ accountId: 'a', title: 'Heizung warten', dueDate: '2026-10-20' });
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-02T07:00:00Z'));
		const deadlineMails = async () =>
			((await post(`Bearer ${token}`)) as { data: Response }).data.json();
		env.DEMO = true;
		expect(await deadlineMails()).toEqual({ deadlineMails: 0 });
		env.DEMO = false;
		expect(await deadlineMails()).toEqual({ deadlineMails: 1 });
		expect(await deadlineMails()).toEqual({ deadlineMails: 0 });
	});
});
