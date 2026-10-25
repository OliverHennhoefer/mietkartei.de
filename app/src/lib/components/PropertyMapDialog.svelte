<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import { pluralize } from '#lib/format.ts';
	import {
		contains,
		frame,
		placeLabels,
		places,
		type MapProperty,
		type PlacedLabel
	} from '#lib/map/frame.ts';

	// All properties on a larger map of Germany, zoomed to where they are, the chosen one marked.
	// The outlines are loaded only when the map opens for the first time.
	let {
		properties,
		selected,
		onclose
	}: {
		properties: MapProperty[];
		/** The property whose tile opened the map. */
		selected: string | undefined;
		onclose: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let clientWidth = $state(0);
	let clientHeight = $state(0);
	let wholeCountry = $state(false);
	let map = $state<typeof import('#lib/map/germany-shapes.ts')>();
	import('#lib/map/germany-shapes.ts').then((module) => (map = module));

	const located = $derived(places(properties));
	const missing = $derived(properties.filter((property) => !property.position).length);
	const aspect = $derived(clientWidth && clientHeight ? clientWidth / clientHeight : 4 / 3);
	const box = $derived(frame(wholeCountry ? [] : located.map((place) => place.position), aspect));
	/** Projected units per pixel, so labels and dots keep their size at every zoom. */
	const unit = $derived(clientHeight ? box.height / clientHeight : 1);

	/** The dots with the property they name: the selected one if it is there, else the first. */
	const dots = $derived(
		located.map((place) => {
			const shown = place.properties.find((property) => property.id === selected);
			const extra = place.properties.length > 1 ? ` +${place.properties.length - 1}` : '';
			const first = shown ?? place.properties[0];
			return { ...place, shown: first, selected: Boolean(shown), text: `${first.name}${extra}` };
		})
	);
	const cities = $derived(
		(map?.cities ?? []).filter((city) => contains(box, city.x, city.y)).slice(0, 16)
	);
	/** The labels of the dots first, the selected one before all, then the cities between them; a
	 * city whose name finds no room is left out with its dot. */
	const labels = $derived.by(() => {
		const ordered = [...dots].sort((a, b) => Number(b.selected) - Number(a.selected));
		const placed = placeLabels(
			[
				...ordered.map((dot) => ({
					x: dot.position[0],
					y: dot.position[1],
					text: dot.text,
					size: (dot.selected ? 13 : 12) * unit,
					required: true
				})),
				...cities.map((city) => ({
					x: city.x,
					y: city.y,
					text: city.name,
					size: 11 * unit,
					required: false
				}))
			],
			dots.map(({ position: [x, y] }) => ({
				x: x - 12 * unit,
				y: y - 12 * unit,
				width: 24 * unit,
				height: 24 * unit
			})),
			11 * unit,
			box
		);
		const byPoint: Record<string, PlacedLabel> = {};
		for (const label of placed) byPoint[`${label.x},${label.y},${label.text}`] = label;
		return byPoint;
	});

	$effect(() => {
		if (!dialog || dialog.matches(':modal')) return;
		dialog.showModal();
	});
</script>

<dialog
	bind:this={dialog}
	class="map-dialog"
	aria-labelledby="map-dialog-title"
	oncancel={(event) => {
		event.preventDefault();
		onclose();
	}}
	onclick={(event) => event.target === dialog && onclose()}
>
	<div class="map-head">
		<div>
			<h2 id="map-dialog-title">Deine Objekte auf der Karte</h2>
			<p class="muted">
				{pluralize(located.length, 'Ort', 'Orte')} nach Postleitzahl{#if missing > 0}
					· {pluralize(missing, 'Objekt', 'Objekte')} ohne bekannte Postleitzahl{/if}
			</p>
		</div>
		<div class="map-actions">
			<button type="button" class="secondary" onclick={() => (wholeCountry = !wholeCountry)}
				>{wholeCountry ? 'Auf Objekte zoomen' : 'Ganz Deutschland'}</button
			>
			<button
				type="button"
				class="icon-button"
				aria-label="Karte schließen"
				title="Schließen"
				onclick={onclose}><Icon name="close" size={20} /></button
			>
		</div>
	</div>
	<div class="map-canvas" bind:clientWidth bind:clientHeight>
		<svg viewBox="{box.x} {box.y} {box.width} {box.height}" role="img" aria-label="Karte">
			{#if map}
				<path class="neighbours" d={map.neighbourShapes} />
				<path class="states" d={map.stateShapes} />
				<path class="country" d={map.germanyDetail} />
			{/if}
			{#each cities as city (city.name)}
				{@const label = labels[`${city.x},${city.y},${city.name}`]}
				{#if label}
					<circle class="city-dot" cx={city.x} cy={city.y} r={2 * unit} />
					<text
						class="city"
						x={city.x + label.dx}
						y={city.y + label.dy}
						text-anchor={label.anchor}
						font-size={label.size}>{city.name}</text
					>
				{/if}
			{/each}
			{#each dots as dot (dot.position.join(','))}
				{@const [x, y] = dot.position}
				{@const label = labels[`${x},${y},${dot.text}`]}
				<a href="/objekte/{dot.shown.id}" class="place" class:selected={dot.selected}>
					<title
						>{dot.properties
							.map((property) => `${property.name}, ${property.city}`)
							.join('\n')}</title
					>
					<circle class="halo" cx={x} cy={y} r={(dot.selected ? 16 : 11) * unit} />
					<circle class="dot" cx={x} cy={y} r={(dot.selected ? 6.5 : 5) * unit} />
					{#if label}
						<text
							class="label"
							x={x + label.dx}
							y={y + label.dy}
							text-anchor={label.anchor}
							font-size={label.size}>{dot.text}</text
						>
					{/if}
				</a>
			{/each}
		</svg>
	</div>
	<p class="map-source muted">
		Karte: Natural Earth · Postleitzahlen: GeoNames (CC BY 4.0). Die Karte lädt nichts von anderen
		Diensten.
	</p>
</dialog>

<style>
	.map-dialog {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		width: min(64rem, calc(100vw - 2rem));
		height: min(46rem, calc(100dvh - 2rem));
		max-width: none;
		max-height: none;
		margin: auto;
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 24px 64px rgb(0 0 0 / 22%);
	}
	.map-dialog::backdrop {
		background: rgb(0 0 0 / 35%);
	}
	.map-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.map-head h2 {
		margin: 0;
		font-size: 1rem;
		letter-spacing: -0.02em;
	}
	.map-head p {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
	}
	.map-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.map-canvas {
		flex: 1;
		min-height: 0;
		border: 1px solid var(--color-map-border);
		border-radius: 10px;
		background: var(--color-map-water);
		overflow: hidden;
	}
	.map-canvas svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.neighbours {
		fill: var(--color-map-neighbour);
		stroke: var(--color-map-land);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.states {
		fill: var(--color-map-land);
		stroke: var(--color-map-line);
		stroke-width: 0.75;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.country {
		fill: none;
		stroke: #6a6a6a;
		stroke-width: 1.25;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.city-dot {
		fill: #7a7a7a;
	}
	.city {
		fill: #8a8a8a;
		font-family: inherit;
	}
	.halo {
		fill: var(--color-highlight);
		opacity: 0.2;
	}
	.dot {
		fill: var(--color-highlight);
	}
	.label {
		fill: #f2f2f2;
		font-family: inherit;
		font-weight: 500;
		paint-order: stroke;
		stroke: var(--color-map-water);
		stroke-width: 3px;
		stroke-linejoin: round;
	}
	.place.selected .label {
		fill: var(--color-highlight);
		font-weight: 650;
	}
	.place:hover .halo,
	.place:focus-visible .halo {
		opacity: 0.4;
	}
	.place:focus-visible {
		outline: none;
	}
	.map-source {
		margin: 0.6rem 0 0;
		font-size: 0.72rem;
	}
	@media (max-width: 40rem) {
		.map-dialog {
			width: 100vw;
			height: 100dvh;
			padding: 1rem;
			border: 0;
			border-radius: 0;
		}
		.map-head {
			flex-wrap: wrap;
		}
	}
</style>
