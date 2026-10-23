<script lang="ts">
	import { formatCents } from '#lib/money.ts';

	// Money in against money out per month or year, as paired bars on one axis. Hovering or
	// focusing a period shows its figures in the readout above the plot; the table below the
	// chart (on the page) has the same numbers for screen readers and print.

	/** `label` is the short axis label ("Mär"), `title` the full one ("März 2026"). */
	type Point = {
		key: string;
		label: string;
		title: string;
		received: number;
		expenses: number;
		net: number;
	};
	let { points, label }: { points: Point[]; label: string } = $props();

	const width = 720;
	const height = 220;
	const padding = { top: 12, right: 8, bottom: 24, left: 64 };
	const plotWidth = width - padding.left - padding.right;
	const plotHeight = height - padding.top - padding.bottom;

	/** A round step for about four grid lines: 1, 2 or 5 times a power of ten (in cents). */
	function niceStep(range: number): number {
		const rough = range / 4;
		const power = 10 ** Math.floor(Math.log10(rough));
		const factor = rough / power;
		return (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10) * power;
	}

	const scale = $derived.by(() => {
		const values = points.flatMap((point) => [point.received, point.expenses]);
		const rawMax = Math.max(0, ...values);
		const rawMin = Math.min(0, ...values);
		const step = niceStep(Math.max(rawMax - rawMin, 100_00));
		const max = Math.ceil(rawMax / step) * step || step;
		const min = Math.floor(rawMin / step) * step;
		const ticks: number[] = [];
		for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(tick);
		const y = (value: number) => padding.top + ((max - value) / (max - min)) * plotHeight;
		return { ticks, y };
	});

	const slot = $derived(plotWidth / Math.max(points.length, 1));
	const barWidth = $derived(Math.max(2, Math.min(18, (slot - 6) / 2 - 1)));

	let active = $state<number | null>(null);
	const shown = $derived(active === null ? null : points[active]);

	/** Short euro labels for the axis: "12 T€" above ten thousand. */
	function axisLabel(cents: number): string {
		const euros = cents / 100;
		if (Math.abs(euros) >= 10_000) return `${Math.round(euros / 1000)} T€`;
		return `${Math.round(euros).toLocaleString('de-DE')} €`;
	}

	/** Every label when they fit, otherwise every second or third. */
	const labelEvery = $derived(Math.ceil(points.length / 12));
</script>

<figure class="flow-chart">
	<div class="legend" aria-hidden="true">
		<span><i class="swatch income"></i>Einnahmen</span>
		<span><i class="swatch expense"></i>Ausgaben</span>
		<span class="readout">
			{#if shown}
				<strong>{shown.title}:</strong>
				{formatCents(shown.received)} ein, {formatCents(shown.expenses)} aus, Überschuss
				{formatCents(shown.net)}
			{:else}
				Zeige auf einen Zeitraum für die Beträge.
			{/if}
		</span>
	</div>
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
				{@const center = padding.left + slot * index + slot / 2}
				{@const zero = scale.y(0)}
				<g
					class="period"
					class:dim={active !== null && active !== index}
					role="button"
					tabindex="0"
					aria-label="{point.title}: {formatCents(point.received)} Einnahmen, {formatCents(
						point.expenses
					)} Ausgaben"
					onmouseenter={() => (active = index)}
					onmouseleave={() => (active = null)}
					onfocus={() => (active = index)}
					onblur={() => (active = null)}
				>
					<rect
						class="hit"
						x={center - slot / 2}
						y={padding.top}
						width={slot}
						height={plotHeight}
					/>
					<rect
						class="bar income"
						x={center - barWidth - 1}
						y={Math.min(scale.y(point.received), zero)}
						width={barWidth}
						height={Math.abs(zero - scale.y(point.received))}
						rx="2"
					/>
					<rect
						class="bar expense"
						x={center + 1}
						y={Math.min(scale.y(point.expenses), zero)}
						width={barWidth}
						height={Math.abs(zero - scale.y(point.expenses))}
						rx="2"
					/>
					{#if index % labelEvery === 0}
						<text class="axis" x={center} y={height - 6} text-anchor="middle">{point.label}</text>
					{/if}
				</g>
			{/each}
		</svg>
	</div>
</figure>

<style>
	.flow-chart {
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: center;
		font-size: 0.9rem;
	}
	.readout {
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}
	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 2px;
		margin-right: 0.35rem;
		vertical-align: -0.1rem;
	}
	.swatch.income,
	.bar.income {
		background: var(--color-chart-income);
		fill: var(--color-chart-income);
	}
	.swatch.expense,
	.bar.expense {
		background: var(--color-chart-expense);
		fill: var(--color-chart-expense);
	}
	/* On a phone the plot keeps a readable size and scrolls sideways instead of shrinking. */
	.plot {
		overflow-x: auto;
	}
	svg {
		display: block;
		min-width: 34rem;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.grid {
		stroke: var(--color-border);
		stroke-width: 1;
	}
	.grid.zero {
		stroke: var(--color-muted);
	}
	.axis {
		fill: var(--color-muted);
		font-size: 11px;
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
	.period.dim .bar {
		opacity: 0.35;
	}
</style>
