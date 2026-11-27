import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeContent } from '#lib/server/import.ts';
import type { Database } from '#lib/server/db/index.ts';
import { listTenants } from '#lib/server/tenants.ts';
import { today } from '#lib/dates.ts';
import { newToolState, toolFile } from '#lib/domain/statement-tool.ts';
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
				kinds: ['properties', 'tenants', 'leases', 'payments', 'expenses'],
				fields: {
					tenants: expect.arrayContaining([
						expect.objectContaining({ name: 'lastName', required: true })
					])
				}
			}
		});
	});

	it('reads the first sheet of an Excel file like a CSV file', async () => {
		const bytes = readFileSync('src/lib/xlsx-fixtures/libreoffice.xlsx');
		const file = new File([bytes], 'vertraege.xlsx');
		const result = (await run('preview', { kind: 'leases', file })) as { data: Preview };
		expect(result.data).toMatchObject({ step: 'preview', total: 2 });
		expect(result.data.mapping).toMatchObject({
			propertyName: 0,
			unitName: 1,
			tenantNames: 2,
			startDate: 3,
			baseRent: 4,
			operatingCostPrepayment: 5
		});
		// Step 2 sends the sheet back as CSV text.
		expect(decodeContent(result.data.content)).toContain('Schulz, Anna;01.04.2021;650,5;180');

		const broken = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'kaputt.xlsx');
		expect(await run('preview', { kind: 'leases', file: broken })).toMatchObject({
			fail: 400,
			data: { errors: { file: expect.stringContaining('Excel-Datei konnte nicht gelesen') } }
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

	it('takes over a file of the free statement tool and opens its draft', async () => {
		const state = newToolState(today());
		state.landlord.name = 'Eva Beispiel';
		state.property = { name: '', street: 'Gartenweg 5', postalCode: '04109', city: 'Leipzig' };
		state.units[0].area = '60';
		state.units[0].tenancies[0].lastName = 'Erdmann';
		state.items[0].amount = '1000';
		const file = new File([toolFile(state)], 'Nebenkostenabrechnung.json', {
			type: 'application/json'
		});
		expect(await run('tool', { toolFile: file })).toMatchObject({
			redirect: expect.stringMatching(/^\/betriebskosten\/abrechnungen\/[\w-]+$/)
		});
	});

	it('asks for the tool file, refuses a huge one and an incomplete one', async () => {
		expect(await run('tool', {})).toMatchObject({
			fail: 400,
			data: { toolError: expect.stringContaining('wähle die gespeicherte Datei') }
		});
		const huge = new File(['x'.repeat(1_000_001)], 'gross.json');
		expect(await run('tool', { toolFile: huge })).toMatchObject({
			fail: 400,
			data: { toolError: expect.stringContaining('zu groß') }
		});
		const incomplete = new File([toolFile(newToolState(today()))], 'leer.json');
		expect(await run('tool', { toolFile: incomplete })).toMatchObject({
			fail: 400,
			data: { toolError: expect.stringContaining('noch nicht vollständig') }
		});
	});

	it('refuses a file that is not from the statement tool', async () => {
		expect(await run('tool', { toolFile: csv(tenants) })).toMatchObject({
			fail: 400,
			data: { toolError: expect.stringContaining('keine gespeicherte Abrechnung') }
		});
	});
});
