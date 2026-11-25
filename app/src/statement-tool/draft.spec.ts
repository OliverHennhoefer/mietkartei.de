import { afterEach, describe, expect, it, vi } from 'vitest';
import { newToolState } from '../lib/domain/statement-tool';
import {
	clearDraft,
	clearRescuedDraft,
	fileSavedOn,
	loadDraft,
	markFileSaved,
	rescuedDraft,
	saveDraft
} from './draft';

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
		expect(loadDraft(today)).toEqual({ rescued: false });
		const state = newToolState(today);
		state.landlord.name = 'Eva Beispiel';
		expect(saveDraft(state)).toBe(true);
		expect(loadDraft(today).state?.landlord.name).toBe('Eva Beispiel');
		markFileSaved(today);
		expect(fileSavedOn()).toBe(today);
		clearDraft();
		expect(loadDraft(today)).toEqual({ rescued: false });
		expect(fileSavedOn()).toBeNull();
	});

	it('keeps a draft it cannot read instead of overwriting it', () => {
		const storage = memoryStorage();
		vi.stubGlobal('localStorage', storage);
		const old = JSON.stringify({ format: 'mietkartei-nebenkostenabrechnung', version: 999 });
		storage.setItem('mietkartei-nebenkostenabrechnung', old);
		expect(loadDraft(today)).toEqual({ rescued: true });
		expect(saveDraft(newToolState(today))).toBe(true);
		expect(rescuedDraft()).toBe(old);
		expect(loadDraft(today).rescued).toBe(true);
		clearRescuedDraft();
		expect(rescuedDraft()).toBeNull();
	});

	it('works without storage, as in a private window', () => {
		const blocked = () => {
			throw new Error('SecurityError');
		};
		vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
		expect(loadDraft(today)).toEqual({ rescued: false });
		expect(saveDraft(newToolState(today))).toBe(false);
		expect(fileSavedOn()).toBeNull();
		expect(() => clearDraft()).not.toThrow();
	});
});
