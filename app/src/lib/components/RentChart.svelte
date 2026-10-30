<script lang="ts">
	import { formatCents } from '#lib/money.ts';

	// What was charged (Soll) against what came in (Ist), per year: the charge as a dashed frame,
	// the money received as the bar inside it, so a gap at the top is rent still missing. Each
	// bar carries its amount; hovering or focusing a year adds the share received in the readout.

	type Point = { key: string; label: string; charged: number; received: number };
	let { points, label }: { points: Point[]; label: string } = $props();

	const width = 720;
	const height = 260;
	const padding = { top: 28, right: 8, bottom: 24, left: 64 };
	const plotWidth = width - padding.left - padding.right;
	const plotHeight = height - padding.top - padding.bottom;

	function niceStep(range: number): number {
		const rough = range / 4;
		const power = 10 ** Math.floor(Math.log10(rough));
		const factor = rough / power;
		return (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10) * power;
	}

	const scale = $derived.by(() => {
		const rawMax = Math.max(0, ...points.flatMap((point) => [point.charged, point.received]));
		const step = niceStep(Math.max(rawMax, 100_00));
		const max = Math.ceil(rawMax / step) * step || step;
		const ticks: number[] = [];
		for (let tick = 0; tick <= max + step / 2; tick += step) ticks.push(tick);
		const y = (value: number) => padding.top + ((max - Math.max(0, value)) / max) * plotHeight;
		return { ticks, y };
	});

	const slot = $derived(plotWidth / Math.max(points.length, 1));
	const frameWidth = $derived(Math.max(8, Math.min(72, slot * 0.55)));
	const center = (index: number) => padding.left + slot * index + slot / 2;

	let active = $state<number | null>(null);
	const shown = $derived(active === null ? null : points[active]);

	function axisLabel(cents: number): string {
		const euros = cents / 100;
		if (Math.abs(euros) >= 10_000) return `${Math.round(euros / 1000)} T€`;
		return `${Math.round(euros).toLocaleString('de-DE')} €`;
	}

	/** "36,4 T€" on the bars: the full amount is in the readout and the table. */
	function short(cents: number): string {
		const euros = cents / 100;
		if (Math.abs(euros) < 10_000) return `${Math.round(euros).toLocaleString('de-DE')} €`;
		return `${(euros / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} T€`;
	}

	function share(point: Point): string {
		if (point.charged <= 0) return '';
		const rate = (point.received / point.charged) * 100;
		return ` (${rate.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %)`;
	}

	const labelEvery = $derived(Math.ceil(points.length / 12));
</script>

<figure class="rent-chart">
	<div class="legend" aria-hidden="true">
		<span><i class="swatch received"></i>Eingegangen (Ist)</span>
		<span><i class="swatch charged"></i>Verlangt (Soll)</span>
	</div>
	<p class="readout" aria-hidden="true">
		{#if shown}
			<strong>{shown.label}:</strong>
			{formatCents(shown.received)} von {formatCents(shown.charged)}{share(shown)}
		{:else}
			Zeige auf ein Jahr für die Beträge.
		{/if}
	</p>
	<div class="plot">
		<svg viewBox="0 0 {width} {height}" role="img" aria-label={label}>
			{#each scale.ticks as tick (tick)}
				<line
					class="grid"
					class:zero={tick === 0}
					x1={padding.left}
					x2={width - padding.right}
					y1={scale.y(tick)}
					y2={scale.y(tick)}
				/>
				<text class="axis" x={padding.left - 8} y={scale.y(tick) + 4} text-anchor="end">
					{axisLabel(tick)}
				</text>
			{/each}
			{#each points as point, index (point.key)}
				{@const x = center(index) - frameWidth / 2}
				{@const zero = scale.y(0)}
				{@const top = Math.min(scale.y(point.charged), scale.y(point.received))}
				<g
					class="period"
					class:dim={active !== null && active !== index}
					role="button"
					tabindex="0"
					aria-label="{point.label}: {formatCents(point.received)} eingegangen, {formatCents(
						point.charged
					)} verlangt"
					onmouseenter={() => (active = index)}
					onmouseleave={() => (active = null)}
					onfocus={() => (active = index)}
					onblur={() => (active = null)}
				>
					<rect class="hit" x={center(index) - slot / 2} y={0} width={slot} height={zero} />
					{#if point.charged > 0}
						<rect
							class="charged"
							{x}
							y={scale.y(point.charged)}
							width={frameWidth}
							height={zero - scale.y(point.charged)}
							rx="4"
						/>
					{/if}
					{#if point.received > 0}
						<rect
							class="received"
							x={x + 4}
							y={scale.y(point.received)}
							width={frameWidth - 8}
							height={Math.max(0, zero - scale.y(point.received))}
							rx="3"
						/>
					{/if}
					{#if point.received > 0 || point.charged > 0}
						<text class="value" x={center(index)} y={top - 8} text-anchor="middle">
							{short(point.received)}
						</text>
					{/if}
					{#if index % labelEvery === 0}
						<text class="axis" x={center(index)} y={height - 6} text-anchor="middle"
							>{point.label}</text
						>
					{/if}
				</g>
			{/each}
		</svg>
	</div>
</figure>

<style>
	.rent-chart {
		margin: 0;
		display: grid;
		gap: 0.25rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		font-size: var(--text-base);
	}
	.readout {
		margin: 0 0 0.5rem;
		color: var(--color-muted);
		font-size: var(--text-base);
		font-variant-numeric: tabular-nums;
		min-height: 1.4em;
	}
	.readout strong {
		color: var(--color-text);
		font-weight: 500;
	}
	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 3px;
		margin-right: 0.35rem;
		vertical-align: -0.1rem;
	}
	.swatch.received {
		background: var(--color-chart-income);
	}
	.swatch.charged {
		border: 1.5px dashed var(--color-muted);
	}
	.plot {
		overflow-x: auto;
	}
	svg {
		display: block;
		min-width: 30rem;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.grid {
		stroke: var(--color-border);
	}
	.grid.zero {
		stroke: var(--color-muted);
	}
	.axis {
		fill: var(--color-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.charged {
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
	}
	.received {
		fill: var(--color-chart-income);
	}
	.value {
		fill: var(--color-text);
		font-size: var(--text-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.hit {
		fill: transparent;
	}
	.period {
		outline: none;
		cursor: default;
	}
	.period:focus-visible .hit {
		fill: var(--color-hover);
	}
	.period.dim .received,
	.period.dim .charged {
		opacity: 0.35;
	}
</style>
