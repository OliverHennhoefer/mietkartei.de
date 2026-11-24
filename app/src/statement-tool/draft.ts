import { parseToolFile, toolFile, type ToolState } from '../lib/domain/statement-tool';

// The draft of the tool in the browser's localStorage, so a reload or a second visit keeps the
// entries. It never leaves the device. Private windows and blocked storage throw; the tool then
// works without a draft.

const KEY = 'mietkartei-nebenkostenabrechnung';

export function loadDraft(today: string): ToolState | undefined {
	try {
		const content = localStorage.getItem(KEY);
		return content ? parseToolFile(content, today) : undefined;
	} catch {
		return undefined;
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

export function clearDraft(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// Nothing stored, nothing to remove.
	}
}
