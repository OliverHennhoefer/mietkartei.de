import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollFade } from './scroll-fade';

// A box of 300 px with 500 px of content, as far as the action looks at it.
function box(scrollLeft = 0) {
	const classes = new Set<string>();
	const listeners = new Map<string, () => void>();
	const node = {
		scrollWidth: 500,
		clientWidth: 300,
		scrollLeft,
		classList: {
			toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name))
		},
		addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
		removeEventListener: (type: string) => listeners.delete(type)
	};
	return { node, classes, listeners };
}

describe('scrollFade', () => {
	const observe = vi.fn();
	const disconnect = vi.fn();
	let resized: () => void = () => {};
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(callback: () => void) {
				resized = callback;
			}
			observe = observe;
			disconnect = disconnect;
		}
	);
	afterEach(() => vi.clearAllMocks());

	it('marks the side where more content waits, and follows the scrolling', () => {
		const { node, classes, listeners } = box();
		scrollFade(node as unknown as HTMLElement);
		expect([...classes]).toEqual(['more-after']);

		node.scrollLeft = 100;
		listeners.get('scroll')!();
		expect([...classes].sort()).toEqual(['more-after', 'more-before']);

		node.scrollLeft = 200;
		listeners.get('scroll')!();
		expect([...classes]).toEqual(['more-before']);
	});

	it('marks nothing once the content fits, and stops listening when destroyed', () => {
		const { node, classes, listeners } = box();
		const action = scrollFade(node as unknown as HTMLElement);
		expect(observe).toHaveBeenCalledWith(node);

		node.clientWidth = 500;
		resized();
		expect([...classes]).toEqual([]);

		action.destroy();
		expect(disconnect).toHaveBeenCalled();
		expect(listeners.size).toBe(0);
	});
});
