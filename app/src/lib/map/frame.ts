import { VIEW } from './projection.ts';

// The section of the large map and the dots on it, in projected units (see projection.ts).

export type MapProperty = { id: string; name: string; city: string; position: number[] | null };

export type Box = { x: number; y: number; width: number; height: number };

/** The smallest span the map zooms in to, in projected units (about 180 km). */
const MIN_SPAN = 160;

/**
 * The section of the map around the given positions with some space around them, at the aspect
 * ratio (width / height) of the map; all of Germany if there are none. A single place is shown
 * with at least MIN_SPAN of its surroundings.
 */
export function frame(positions: number[][], aspect: number): Box {
	if (positions.length === 0) return fit({ x: 0, y: 0, ...VIEW }, aspect);
	const xs = positions.map((position) => position[0]);
	const ys = positions.map((position) => position[1]);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const width = Math.max(MIN_SPAN, (maxX - minX) * 1.3);
	const height = Math.max(MIN_SPAN, (maxY - minY) * 1.3);
	return fit(
		{ x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height },
		aspect
	);
}

/** The box widened or heightened around its centre to the aspect ratio. */
function fit(box: Box, aspect: number): Box {
	const width = Math.max(box.width, box.height * aspect);
	const height = width / aspect;
	return {
		x: box.x + (box.width - width) / 2,
		y: box.y + (box.height - height) / 2,
		width,
		height
	};
}

export function contains(box: Box, x: number, y: number): boolean {
	return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/** The dots of the map: properties at the same place (the same postal code) share one. */
export function places(properties: MapProperty[]) {
	const byPosition: Record<string, { position: number[]; properties: MapProperty[] }> = {};
	for (const property of properties) {
		if (!property.position) continue;
		const key = property.position.join(',');
		byPosition[key] ??= { position: property.position, properties: [] };
		byPosition[key].properties.push(property);
	}
	return Object.values(byPosition);
}

export type Label = { x: number; y: number; text: string; size: number };
export type PlacedLabel = Label & { anchor: 'start' | 'end'; dx: number; dy: number };

/** The rough box of a label at an offset, in projected units; Geist averages 0.56 em a glyph. */
function labelBox(label: Label, anchor: 'start' | 'end', dx: number, dy: number): Box {
	const width = label.text.length * label.size * 0.56;
	const left = anchor === 'start' ? label.x + dx : label.x + dx - width;
	return { x: left, y: label.y + dy - label.size * 0.8, width, height: label.size };
}

function overlaps(a: Box, b: Box): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(inner: Box, outer: Box): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

/**
 * Places the labels one after the other inside the view where they hit none placed before, nor a
 * dot (given as small boxes). Labels that must show try right, left, then above and below on either side of their point
 * and fall back to a side that stays in view; the others (city names) show only to the right and
 * are left out if they collide.
 */
export function placeLabels(
	labels: (Label & { required: boolean })[],
	dots: Box[],
	gap: number,
	view: Box
): PlacedLabel[] {
	const taken = [...dots];
	const placed: PlacedLabel[] = [];
	for (const label of labels) {
		// A property's own dot does not count, the gap keeps its label off it; a city name still
		// gives way to a property's dot on the same spot.
		const own = label.required ? dots.find((dot) => contains(dot, label.x, label.y)) : undefined;
		const candidates: [PlacedLabel['anchor'], number, number][] = label.required
			? [
					['start', gap, label.size * 0.35],
					['end', -gap, label.size * 0.35],
					['start', gap * 0.6, -label.size * 0.9],
					['start', gap * 0.6, label.size * 1.5],
					['end', -gap * 0.6, -label.size * 0.9],
					['end', -gap * 0.6, label.size * 1.5]
				]
			: [['start', gap, label.size * 0.35]];
		const visible = candidates.filter(([anchor, dx, dy]) =>
			inside(labelBox(label, anchor, dx, dy), view)
		);
		const free = visible.find(([anchor, dx, dy]) => {
			const box = labelBox(label, anchor, dx, dy);
			return !taken.some((other) => other !== own && overlaps(box, other));
		});
		const choice = free ?? (label.required ? (visible[0] ?? candidates[0]) : undefined);
		if (!choice) continue;
		const [anchor, dx, dy] = choice;
		taken.push(labelBox(label, anchor, dx, dy));
		placed.push({ ...label, anchor, dx, dy });
	}
	return placed;
}
