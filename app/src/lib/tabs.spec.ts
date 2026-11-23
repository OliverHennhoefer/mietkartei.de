import { describe, expect, it } from 'vitest';
import { isCurrentTab, titleTab, type Tab } from './tabs';

const tabs: Tab[] = [
	{ href: '/objekte/1', label: 'Einheiten', also: ['/objekte/1/einheiten'] },
	{ href: '/objekte/1/zaehler', label: 'Zähler' },
	{ href: '/objekte/1/steuer', label: 'Steuer' }
];

describe('isCurrentTab', () => {
	it('matches the first tab only on its own path and on the paths it also owns', () => {
		expect(isCurrentTab(tabs[0], 0, '/objekte/1')).toBe(true);
		expect(isCurrentTab(tabs[0], 0, '/objekte/1/zaehler')).toBe(false);
		expect(isCurrentTab(tabs[0], 0, '/objekte/1/einheiten/7')).toBe(true);
	});

	it('matches a later tab on its path and the pages below it', () => {
		expect(isCurrentTab(tabs[1], 1, '/objekte/1/zaehler')).toBe(true);
		expect(isCurrentTab(tabs[1], 1, '/objekte/1/zaehler/7')).toBe(true);
		expect(isCurrentTab(tabs[1], 1, '/objekte/1/zaehlerstand')).toBe(false);
	});
});

describe('titleTab', () => {
	it('names the current tab, but not the first one or a path off the tabs', () => {
		expect(titleTab(tabs, '/objekte/1/steuer')).toBe('Steuer');
		expect(titleTab(tabs, '/objekte/1')).toBeUndefined();
		expect(titleTab(tabs, '/objekte/1/einheiten/7')).toBeUndefined();
		expect(titleTab(tabs, '/mieter')).toBeUndefined();
	});
});
