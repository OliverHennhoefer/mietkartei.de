import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { outbox } from '#lib/server/db/schema.ts';
import { getLease } from '#lib/server/leases.ts';
import * as mail from '#lib/server/mail.ts';
import { findPortal, getPortalLink } from '#lib/server/portal.ts';
import {
	outcome,
	routeEvent,
	seedLease,
	seedTenant,
	seedUnit,
	testDatabase
} from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

const env = vi.hoisted(() => ({ ORIGIN: '', MAIL_TRANSPORT: 'outbox' }));
vi.mock('$app/env/private', () => env);

let db: Database;
let leaseId: string;

beforeEach(async () => {
	db = await testDatabase();
	Object.assign(env, { ORIGIN: '', MAIL_TRANSPORT: 'outbox' });
	const { unitId } = await seedUnit(db, 'a');
	const tenantIds = [
		await seedTenant(db, 'a', { email: 'erika@example.org' }),
		await seedTenant(db, 'a', { firstName: 'Max', email: null })
	];
	leaseId = await seedLease(db, 'a', unitId, { tenantIds });
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function run(
	handler: (event: never) => unknown,
	options: Parameters<typeof routeEvent>[1] = {}
) {
	const lease = await getLease(db, 'a', leaseId);
	return outcome(() =>
		handler(routeEvent(db, { params: { id: leaseId }, parent: { lease }, ...options }))
	);
}

/** The token in a link the action answered with or mailed. */
const tokenOf = (link: string) => link.split('/mieterportal/')[1];

describe('vertraege/[id]/mieterportal', () => {
	it('starts without a link and offers the tenants’ addresses', async () => {
		expect(await run(load)).toEqual({
			data: { link: null, recipients: ['erika@example.org'], reports: [] }
		});
	});

	it('shows a new link once and replaces the older one', async () => {
		const first = (await run(actions.create)) as { data: { created: string } };
		expect(first.data.created).toMatch(/^http:\/\/localhost\/mieterportal\/[\w-]{43}$/);
		env.ORIGIN = 'https://app.example.org';
		const second = (await run(actions.create)) as { data: { created: string } };
		expect(second.data.created).toMatch(/^https:\/\/app\.example\.org\/mieterportal\//);
		expect(await findPortal(db, tokenOf(first.data.created))).toBeUndefined();
		expect(await findPortal(db, tokenOf(second.data.created))).toMatchObject({ leaseId });
		expect(await run(load)).toMatchObject({ data: { link: { createdAt: expect.any(Date) } } });
	});

	it('mails a new link to the tenants with an address', async () => {
		expect(await run(actions.send)).toEqual({ data: { sentTo: ['erika@example.org'] } });
		const [sent] = await db.select().from(outbox);
		expect(sent).toMatchObject({ to: 'erika@example.org' });
		const link = /http:\/\/localhost\/mieterportal\/\S+/.exec(sent.text)![0];
		expect(await findPortal(db, tokenOf(link))).toMatchObject({ leaseId });
	});

	it('refuses to mail without an origin for links, or when the mail fails', async () => {
		expect(await run(actions.send, { url: 'http://intern.example/x' })).toMatchObject({
			fail: 503
		});
		expect(await getPortalLink(db, 'a', leaseId)).toBeUndefined();
		vi.spyOn(mail, 'sendMail').mockRejectedValue(new Error('down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await run(actions.send)).toMatchObject({ fail: 502 });
	});

	it('locks the link out', async () => {
		await run(actions.create);
		expect(await run(actions.revoke)).toEqual({ data: { revoked: true } });
		expect(await getPortalLink(db, 'a', leaseId)).toBeUndefined();
	});

	it('answers 404 for a lease of another account', async () => {
		const other = { params: { id: 'unbekannt' } };
		expect(await run(actions.create, other)).toMatchObject({ error: 404 });
		expect(await run(actions.send, other)).toMatchObject({ error: 404 });
	});
});
