import { parseToolFile, toolFile, type ToolState } from '../lib/domain/statement-tool';

// The draft of the tool in the browser's localStorage, so a reload or a second visit keeps the
// entries. It never leaves the device. Private windows and blocked storage throw; the tool then
// works without a draft. Browsers may still clear the storage (Safari after seven days without a
// visit, or when someone clears site data), so the tool also reminds people to save a file.

const KEY = 'mietkartei-nebenkostenabrechnung';
// A stored draft this version cannot read is kept here instead of being overwritten.
const RESCUE_KEY = `${KEY}-unlesbar`;
// The day the entries were last saved as a file.
const FILE_KEY = `${KEY}-datei`;

export interface Draft {
	state?: ToolState;
	/** A draft was stored but could not be read; its content is kept for download. */
	rescued: boolean;
}

export function loadDraft(today: string): Draft {
	try {
		const content = localStorage.getItem(KEY);
		if (!content) return { rescued: rescuedDraft() !== null };
		const state = parseToolFile(content, today);
		if (state) return { state, rescued: rescuedDraft() !== null };
		if (localStorage.getItem(RESCUE_KEY) === null) localStorage.setItem(RESCUE_KEY, content);
		localStorage.removeItem(KEY);
		return { rescued: true };
	} catch {
		return { rescued: false };
	}
}

export function saveDraft(state: ToolState): boolean {
	try {
		localStorage.setItem(KEY, toolFile(state));
		return true;
	} catch {
		return false;
	}
}

/** Removes the stored entries but keeps the date of the last file save. */
export function forgetDraft(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// Nothing stored, nothing to remove.
	}
}

export function clearDraft(): void {
	try {
		localStorage.removeItem(KEY);
		localStorage.removeItem(FILE_KEY);
	} catch {
		// Nothing stored, nothing to remove.
	}
}

/** The content of a draft this version could not read, or null. */
export function rescuedDraft(): string | null {
	try {
		return localStorage.getItem(RESCUE_KEY);
	} catch {
		return null;
	}
}

export function clearRescuedDraft(): void {
	try {
		localStorage.removeItem(RESCUE_KEY);
	} catch {
		// Nothing stored, nothing to remove.
	}
}

/** The day the entries were last saved as a file, or null. */
export function fileSavedOn(): string | null {
	try {
		return localStorage.getItem(FILE_KEY);
	} catch {
		return null;
	}
}

export function markFileSaved(day: string): void {
	try {
		localStorage.setItem(FILE_KEY, day);
	} catch {
		// Without storage there is nothing to remember.
	}
}
