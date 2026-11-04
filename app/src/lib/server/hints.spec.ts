import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './db';
import { dismissedHints, users } from './db/schema';
import { dismissHints, hintKey, isHintKey, restoreHints, withDismissals } from './hints';
import { ownerA, testDatabase } from './testing';

let db: Database;

beforeEach(async () => {
	db = await testDatabase();
});

const hints = [
	{ code: 'above_benchmark', message: 'Versicherungen: 0,66 € je m² und Monat', blocking: false },
	{ code: 'no_weight', message: 'Der Beleg lässt sich nicht verteilen', blocking: true }
];

describe('hintKey', () => {
	it('depends on the place and the text', async () => {
		const key = await hintKey('steuer:p:2025', 'Text');
		expect(isHintKey(key)).toBe(true);
		expect(await hintKey('steuer:p:2025', 'Text')).toBe(key);
		expect(await hintKey('steuer:p:2024', 'Text')).not.toBe(key);
		expect(await hintKey('steuer:p:2025', 'Anderer Text')).not.toBe(key);
	});

	it('takes nothing but a hex SHA-256 as a key', () => {
		expect(isHintKey('a'.repeat(64))).toBe(true);
		expect(isHintKey('A'.repeat(64))).toBe(false);
		expect(isHintKey('a'.repeat(63))).toBe(false);
		expect(isHintKey(undefined)).toBe(false);
	});
});

describe('withDismissals', () => {
	it('marks what the user closed, for that user only', async () => {
		const before = await withDismissals(db, ownerA.id, 'abrechnung:p:2024-01-01', hints);
		expect(before.map((hint) => hint.dismissed)).toEqual([false, false]);

		await dismissHints(db, ownerA, [before[0].key]);
		const after = await withDismissals(db, ownerA.id, 'abrechnung:p:2024-01-01', hints);
		expect(after.map((hint) => hint.dismissed)).toEqual([true, false]);
		expect(after[0]).toMatchObject({ code: 'above_benchmark', key: before[0].key });

		await db.insert(users).values({
			id: 'user-a2',
			accountId: 'a',
			email: 'a2@example.org',
			passwordHash: 'x',
			role: 'manager'
		});
		const other = await withDismissals(db, 'user-a2', 'abrechnung:p:2024-01-01', hints);
		expect(other.map((hint) => hint.dismissed)).toEqual([false, false]);
	});

	it('shows a closed Hinweis again once its text changes', async () => {
		const [first] = await withDismissals(db, ownerA.id, 'steuer:p:2025', hints);
		await dismissHints(db, ownerA, [first.key]);
		const changed = [{ ...hints[0], message: 'Versicherungen: 0,70 € je m² und Monat' }];
		const [again] = await withDismissals(db, ownerA.id, 'steuer:p:2025', changed);
		expect(again.dismissed).toBe(false);
	});

	it('never hides a Hinweis that blocks the approval', async () => {
		const keyed = await withDismissals(db, ownerA.id, 'x', hints);
		await dismissHints(db, ownerA, [keyed[1].key]);
		const after = await withDismissals(db, ownerA.id, 'x', hints);
		expect(after[1].dismissed).toBe(false);
	});

	it('shows a text that comes twice once', async () => {
		const twice = await withDismissals(db, ownerA.id, 'x', [hints[0], { ...hints[0] }]);
		expect(twice).toHaveLength(1);
	});
});

describe('dismissHints and restoreHints', () => {
	it('closes a Hinweis once and shows it again', async () => {
		const key = await hintKey('x', 'Text');
		await dismissHints(db, ownerA, [key]);
		await dismissHints(db, ownerA, [key]);
		expect(await db.select().from(dismissedHints)).toMatchObject([
			{ accountId: 'a', userId: ownerA.id, key }
		]);
		await restoreHints(db, ownerA.id, [key]);
		expect(await db.select().from(dismissedHints)).toEqual([]);
	});

	it('takes more keys than one statement may bind', async () => {
		const keys = await Promise.all(
			Array.from({ length: 250 }, (_, index) => hintKey('x', String(index)))
		);
		await dismissHints(db, ownerA, keys);
		expect(await db.select().from(dismissedHints)).toHaveLength(250);
		await restoreHints(db, ownerA.id, keys);
		expect(await db.select().from(dismissedHints)).toHaveLength(0);
	});
});
