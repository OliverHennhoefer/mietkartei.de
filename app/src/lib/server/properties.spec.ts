import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { accounts } from './db/schema';
import { createSqliteDatabase } from './db/sqlite';
import { createProperty, createUnit, getProperty, listProperties, listUnits } from './properties';

const address = { street: 'Lindenstraße 4', postalCode: '10115', city: 'Berlin' };

let db: Database;

beforeEach(async () => {
	db = createSqliteDatabase(':memory:');
	await db.insert(accounts).values([
		{ id: 'a', name: 'Konto A' },
		{ id: 'b', name: 'Konto B' }
	]);
});

describe('properties', () => {
	it('lists only the properties of the given account, sorted by name', async () => {
		await createProperty(db, 'a', { name: 'Zweites Haus', ...address });
		await createProperty(db, 'a', { name: 'Erstes Haus', ...address });
		await createProperty(db, 'b', { name: 'Fremdes Haus', ...address });

		const names = (await listProperties(db, 'a')).map((property) => property.name);
		expect(names).toEqual(['Erstes Haus', 'Zweites Haus']);
	});

	it('does not return a property of another account', async () => {
		const property = await createProperty(db, 'b', { name: 'Fremdes Haus', ...address });
		expect(await getProperty(db, 'a', property.id)).toBeUndefined();
		expect(await getProperty(db, 'b', property.id)).toMatchObject({ name: 'Fremdes Haus' });
	});
});

describe('units', () => {
	it('creates units within a property of the same account', async () => {
		const property = await createProperty(db, 'a', { name: 'Haus', ...address });
		await createUnit(db, 'a', property.id, { name: 'OG', kind: 'apartment', floorArea: 64 });
		await createUnit(db, 'a', property.id, { name: 'EG', kind: 'commercial', floorArea: null });

		const units = await listUnits(db, 'a', property.id);
		expect(units.map((unit) => [unit.name, unit.kind, unit.floorArea])).toEqual([
			['EG', 'commercial', null],
			['OG', 'apartment', 64]
		]);
	});

	it('refuses to add a unit to a property of another account', async () => {
		const property = await createProperty(db, 'b', { name: 'Fremdes Haus', ...address });
		const unit = await createUnit(db, 'a', property.id, {
			name: 'EG',
			kind: 'apartment',
			floorArea: null
		});
		expect(unit).toBeUndefined();
		expect(await listUnits(db, 'b', property.id)).toEqual([]);
	});
});
