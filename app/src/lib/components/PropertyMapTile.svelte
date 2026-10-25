<script lang="ts" module>
	import { VIEW } from '#lib/map/projection.ts';

	// Germany in a landscape frame: the country fills the height, the sides stay dark.
	const height = VIEW.height + 60;
	const width = height * 1.5;
	const tileViewBox = `${(VIEW.width - width) / 2} -30 ${width} ${height}`;
</script>

<script lang="ts">
	// The small map in front of a property: Germany in grey, the property as a neon dot. The page
	// defines the outline once as #germany-outline; every tile only references it.
	let {
		position,
		label,
		onclick
	}: {
		/** The property in projected units, or null if its postal code is unknown. */
		position: number[] | null;
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
	<svg viewBox={tileViewBox} aria-hidden="true">
		<use href="#germany-outline" class="map-land" />
		{#if position}
			<circle class="map-halo" cx={position[0]} cy={position[1]} r="95" />
			<circle class="map-dot" cx={position[0]} cy={position[1]} r="44" />
		{/if}
	</svg>
</button>

<style>
	.map-tile {
		display: block;
		flex-shrink: 0;
		align-self: center;
		min-height: 0;
		width: 5.75rem;
		height: 3.85rem;
		padding: 0;
		border: 1px solid var(--color-map-border);
		border-radius: 10px;
		background: var(--color-map-water);
		overflow: hidden;
		cursor: pointer;
		transition:
			border-color 140ms,
			transform 140ms;
	}
	.map-tile:hover {
		border-color: var(--color-muted);
		background: var(--color-map-water);
	}
	.map-tile svg {
		display: block;
		width: 100%;
		height: 100%;
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
	@media (max-width: 40rem) {
		.map-tile {
			align-self: flex-start;
			width: 4.5rem;
			height: 3rem;
		}
	}
</style>
