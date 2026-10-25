import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '#lib/server/db/index.ts';
import { listTenants } from '#lib/server/tenants.ts';
import { outcome, routeEvent, testDatabase } from '#lib/server/testing.ts';
import { actions, load } from './+page.server';

// The two steps: the upload answers with a preview and a proposed mapping, the commit sends the
// file back in a hidden field with the mapping as chosen.

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

const csv = (text: string) => new File([text], 'mieter.csv', { type: 'text/csv' });
const tenants = 'Vorname;Nachname;E-Mail\nMax;Müller;max@example.org\nErika;;erika@example.org';

type Preview = {
	step: 'preview';
	content: string;
	mapping: Record<string, number | null>;
	total: number;
	planned: number;
	message?: string;
};

function run(action: keyof typeof actions, form: Record<string, string | File>) {
	return outcome(() => actions[action](routeEvent(db, { form })));
}

/** The hidden fields of the preview form: kind, content and the mapping selects. */
function previewForm(preview: Preview, kind = 'tenants') {
	const form: Record<string, string> = { kind, content: preview.content };
	for (const [field, column] of Object.entries(preview.mapping)) {
		form[`map.${field}`] = column === null ? '' : String(column);
	}
	return form;
}

describe('datenuebernahme', () => {
	it('names the fields of every kind', async () => {
		expect(await outcome(() => load(routeEvent(db)))).toMatchObject({
			data: {
				kinds: ['properties', 'tenants', 'leases', 'payments'],
				fields: {
					tenants: expect.arrayContaining([
						expect.objectContaining({ name: 'lastName', required: true })
					])
				}
			}
		});
	});

	it('previews the file and imports its valid rows', async () => {
		const result = (await run('preview', { kind: 'tenants', file: csv(tenants) })) as {
			data: Preview;
		};
		expect(result.data).toMatchObject({
			step: 'preview',
			total: 2,
			planned: 1,
			message: undefined
		});
		expect(result.data.mapping).toMatchObject({ firstName: 0, lastName: 1, email: 2 });

		expect(await run('commit', previewForm(result.data))).toMatchObject({
			data: { step: 'done', summary: expect.anything() }
		});
		expect((await listTenants(db, 'a')).map((tenant) => tenant.lastName)).toEqual(['Müller']);
	});

	it('refuses to commit while a required field has no column, or nothing is valid', async () => {
		const result = (await run('preview', { kind: 'tenants', file: csv(tenants) })) as {
			data: Preview;
		};
		const unmapped = { ...previewForm(result.data), 'map.lastName': '' };
		expect(await run('preview', unmapped)).toMatchObject({
			data: { message: expect.stringContaining('„Nachname“') }
		});
		expect(await run('commit', unmapped)).toMatchObject({
			fail: 400,
			data: { message: expect.stringContaining('Pflichtfeld') }
		});
		const both = { ...unmapped, 'map.firstName': '' };
		expect(await run('commit', both)).toMatchObject({
			fail: 400,
			data: { message: expect.stringContaining('Pflichtfelder') }
		});

		const invalid = (await run('preview', {
			kind: 'tenants',
			file: csv('Vorname;Nachname\n;')
		})) as { data: Preview };
		expect(await run('commit', previewForm(invalid.data))).toMatchObject({
			fail: 400,
			data: { message: 'Keine Zeile der Datei ist gültig; es wurde nichts importiert.' }
		});
	});

	it('refuses files without data rows or with a broken mapping', async () => {
		expect(await run('preview', { kind: 'tenants', file: csv('Vorname;Nachname') })).toMatchObject({
			fail: 400,
			data: { errors: { file: expect.stringContaining('keine Datenzeilen') } }
		});
		expect(await run('preview', { kind: 'tenants' })).toMatchObject({ fail: 400 });
		expect(await run('preview', { kind: 'tenants', content: '%%%' })).toMatchObject({
			fail: 400,
			data: { errors: { file: 'Die Datei konnte nicht gelesen werden.' } }
		});
		expect(
			await run('preview', { kind: 'tenants', file: csv(tenants), 'map.lastName': '-1' })
		).toMatchObject({ fail: 400 });
		const huge = `Vorname;Nachname\n${'M;M\n'.repeat(10_001)}`;
		expect(await run('preview', { kind: 'tenants', file: csv(huge) })).toMatchObject({
			fail: 400,
			data: { errors: { file: expect.stringContaining('höchstens') } }
		});
	});
});
