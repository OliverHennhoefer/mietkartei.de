<script lang="ts" module>
	import { VIEW } from '#lib/map/projection.ts';

	// Germany in a landscape frame: the country fills the height, the sides stay dark.
	const height = VIEW.height + 60;
	const width = height * 1.5;
	const tileViewBox = `${(VIEW.width - width) / 2} -30 ${width} ${height}`;
</script>

<script lang="ts">
	// The small map in front of a property: its streets as an image drawn by the server where the
	// street map is set up, else Germany in grey with the property as a neon dot. The page defines
	// that outline once as #germany-outline; every tile only references it.
	let {
		position,
		image,
		label,
		onclick
	}: {
		/** The property in projected units, or null if its postal code is unknown. */
		position: number[] | null;
		/** The link of its street map image, or null without one. */
		image: string | null;
		label: string;
		onclick: () => void;
	} = $props();
</script>

<button
	type="button"
	class="map-tile"
	aria-label={label}
	title={position ? 'Auf der Karte zeigen' : 'Für diese Postleitzahl kennt die Karte keinen Ort.'}
	{onclick}
>
	{#if image}
		<img src={image} alt="" loading="lazy" decoding="async" fetchpriority="low" />
	{:else}
		<svg viewBox={tileViewBox} aria-hidden="true">
			<use href="#germany-outline" class="map-land" />
			{#if position}
				<circle class="map-halo" cx={position[0]} cy={position[1]} r="95" />
				<circle class="map-dot" cx={position[0]} cy={position[1]} r="44" />
			{/if}
		</svg>
	{/if}
</button>

<style>
	.map-tile {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 0;
		padding: 0;
		border: 0;
		border-right: 1px solid var(--color-border);
		border-radius: 0;
		background: var(--color-map-water);
		overflow: hidden;
		cursor: pointer;
		align-self: stretch;
	}
	.map-tile:hover {
		background: var(--color-map-water);
	}
	.map-tile:hover svg,
	.map-tile:hover img {
		opacity: 0.85;
	}
	.map-tile:focus-visible {
		outline-offset: -3px;
	}
	.map-tile svg,
	.map-tile img {
		display: block;
		width: 100%;
		height: 100%;
	}
	/* The image is wider than most tiles; it keeps its scale and is cut at the sides. */
	.map-tile img {
		object-fit: cover;
	}
	.map-land {
		fill: var(--color-map-tile-land);
		stroke: var(--color-map-line);
		stroke-width: 10;
		stroke-linejoin: round;
	}
	.map-dot {
		fill: var(--color-highlight);
	}
	.map-halo {
		fill: var(--color-highlight);
		opacity: 0.22;
	}
</style>
