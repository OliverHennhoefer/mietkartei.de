import { afterEach, describe, expect, it, vi } from 'vitest';
import { newToolState } from '../lib/domain/statement-tool';
import { clearDraft, loadDraft, saveDraft } from './draft';

const today = '2026-03-01';

afterEach(() => {
	vi.unstubAllGlobals();
});

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key)
	};
}

describe('draft', () => {
	it('keeps the entries in the browser between visits', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		expect(loadDraft(today)).toBeUndefined();
		const state = newToolState(today);
		state.landlord.name = 'Eva Beispiel';
		expect(saveDraft(state)).toBe(true);
		expect(loadDraft(today)?.landlord.name).toBe('Eva Beispiel');
		clearDraft();
		expect(loadDraft(today)).toBeUndefined();
	});

	it('works without storage, as in a private window', () => {
		const blocked = () => {
			throw new Error('SecurityError');
		};
		vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
		expect(loadDraft(today)).toBeUndefined();
		expect(saveDraft(newToolState(today))).toBe(false);
		expect(() => clearDraft()).not.toThrow();
	});
});
