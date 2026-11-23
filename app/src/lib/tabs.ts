// The tabs of a tab bar (components/Tabs.svelte) and which of them a path belongs to.

/** `also` lists further path prefixes a tab owns, e.g. the unit pages below an overview tab. */
export type Tab = { href: string; label: string; also?: string[] };

const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Whether the tab is the current one: its href matches the path or is its prefix for nested
 * pages; the first tab only matches exactly, as it is the overview.
 */
export function isCurrentTab(tab: Tab, index: number, path: string): boolean {
	if (tab.also?.some((prefix) => within(path, prefix))) return true;
	return index === 0 ? path === tab.href : within(path, tab.href);
}

/**
 * The label of the current tab for the page title, so the tabs of one page differ in the browser's
 * tab bar and history. Undefined on the first tab, which is the page itself, and off the tabs.
 */
export function titleTab(tabs: readonly Tab[], path: string): string | undefined {
	return tabs.find((tab, index) => index > 0 && isCurrentTab(tab, index, path))?.label;
}
