import { describe, expect, it } from 'vitest';
import { contains, frame, placeLabels, places } from './frame.ts';
import { project, VIEW } from './projection.ts';

describe('project', () => {
	it('puts Germany inside its view', () => {
		const corners = [
			project(55.06, 8.42), // List auf Sylt
			project(47.27, 10.18), // Haldenwanger Eck
			project(51.05, 5.87), // Selfkant
			project(51.27, 15.04) // Görlitz-Deschka
		];
		for (const [x, y] of corners) expect(contains({ x: 0, y: 0, ...VIEW }, x, y)).toBe(true);
	});
});

describe('frame', () => {
	it('shows all of Germany without positions', () => {
		const box = frame([], 1);
		expect(box.width).toBe(VIEW.height);
		expect(box.height).toBe(VIEW.height);
		expect(box.x + box.width / 2).toBeCloseTo(VIEW.width / 2);
	});

	it('frames all positions at the requested aspect ratio', () => {
		const positions = [
			[100, 200],
			[400, 300]
		];
		const box = frame(positions, 2);
		expect(box.width / box.height).toBeCloseTo(2);
		for (const [x, y] of positions) expect(contains(box, x, y)).toBe(true);
		expect(contains(box, 600, 300)).toBe(false);
	});

	it('keeps surroundings around a single place', () => {
		const box = frame([[300, 300]], 1);
		expect(box).toEqual({ x: 220, y: 220, width: 160, height: 160 });
		expect(frame([[300, 300]], 0.5)).toMatchObject({ width: 160, height: 320 });
	});
});

describe('places', () => {
	it('groups properties by position and skips those without one', () => {
		const result = places([
			{ id: 'a', name: 'A', city: 'Berlin', position: [1, 2] },
			{ id: 'b', name: 'B', city: 'Berlin', position: [1, 2] },
			{ id: 'c', name: 'C', city: 'Köln', position: [3, 4] },
			{ id: 'd', name: 'D', city: 'Nirgendwo', position: null }
		]);
		expect(result.map((place) => place.properties.map((property) => property.id))).toEqual([
			['a', 'b'],
			['c']
		]);
	});
});

describe('placeLabels', () => {
	const view = { x: -1000, y: -1000, width: 2000, height: 2000 };
	const dot = (x: number, y: number) => ({ x: x - 2, y: y - 2, width: 4, height: 4 });

	it('moves a required label away from one placed before', () => {
		const placed = placeLabels(
			[
				{ x: 0, y: 0, text: 'Lindenstraße', size: 10, required: true },
				{ x: 0, y: 2, text: 'Parkallee', size: 10, required: true }
			],
			[dot(0, 0), dot(0, 2)],
			5,
			view
		);
		expect(placed.map((label) => label.anchor)).toEqual(['start', 'end']);
	});

	it('falls back to the right for required labels and leaves out colliding optional ones', () => {
		const labels = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
			x: 0,
			y: offset,
			text: 'Sehr langer Name',
			size: 10,
			required: true
		}));
		const placed = placeLabels(
			[...labels, { x: 0, y: 0, text: 'Berlin', size: 10, required: false }],
			[],
			5,
			view
		);
		expect(placed).toHaveLength(7);
		expect(placed.at(-1)).toMatchObject({ anchor: 'start', dx: 5 });
		expect(
			placeLabels([{ x: 100, y: 100, text: 'Köln', size: 10, required: false }], [], 5, view)
		).toMatchObject([{ text: 'Köln', anchor: 'start' }]);
	});

	it('keeps labels inside the view', () => {
		const edge = { x: 0, y: 0, width: 100, height: 100 };
		const label = { x: 95, y: 50, text: 'Lindenstraße', size: 10, required: true };
		expect(placeLabels([label], [], 5, edge)).toMatchObject([{ anchor: 'end' }]);
		expect(placeLabels([{ ...label, x: 300, required: false }], [], 5, edge)).toEqual([]);
		expect(placeLabels([{ ...label, x: 300 }], [], 5, edge)).toMatchObject([{ anchor: 'start' }]);
	});
});
