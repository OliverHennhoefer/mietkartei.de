<script lang="ts">
	import { formatCents } from '#lib/money.ts';

	// Money in against money out per month or year, as paired bars on one axis, with the surplus
	// added up period by period as a line on the neon of the logo. The line stops at `until`
	// (periods still to come stay empty). Hovering or focusing a period shows its figures in the
	// readout above the plot; the table below the chart (on the page) has the same numbers for
	// screen readers and print.

	/** `label` is the short axis label ("Mär"), `title` the full one ("März 2026"). */
	type Point = {
		key: string;
		label: string;
		title: string;
		received: number;
		expenses: number;
		net: number;
	};
	let {
		points,
		label,
		until = points.length
	}: { points: Point[]; label: string; until?: number } = $props();

	const width = 720;
	const height = 240;
	const padding = { top: 16, right: 8, bottom: 24, left: 64 };
	const plotWidth = width - padding.left - padding.right;
	const plotHeight = height - padding.top - padding.bottom;

	/** The surplus so far after each period, up to `until`. */
	const cumulative = $derived.by(() => {
		let sum = 0;
		return points.slice(0, until).map((point) => (sum += point.net));
	});

	/** A round step for about four grid lines: 1, 2 or 5 times a power of ten (in cents). */
	function niceStep(range: number): number {
		const rough = range / 4;
		const power = 10 ** Math.floor(Math.log10(rough));
		const factor = rough / power;
		return (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10) * power;
	}

	const scale = $derived.by(() => {
		const values = [...points.flatMap((point) => [point.received, point.expenses]), ...cumulative];
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
	const barWidth = $derived(Math.max(2, Math.min(20, (slot - 8) / 2 - 1)));
	const center = (index: number) => padding.left + slot * index + slot / 2;

	/** A bar from the zero line to `value`, rounded only at its far end. */
	function bar(x: number, value: number): string {
		const zero = scale.y(0);
		const end = scale.y(value);
		const length = Math.abs(zero - end);
		if (length < 0.5) return '';
		const r = Math.min(4, barWidth / 2, length);
		const dir = end < zero ? 1 : -1;
		return [
			`M${x},${zero}`,
			`V${end + dir * r}`,
			`Q${x},${end} ${x + r},${end}`,
			`H${x + barWidth - r}`,
			`Q${x + barWidth},${end} ${x + barWidth},${end + dir * r}`,
			`V${zero}Z`
		].join('');
	}

	const line = $derived(
		cumulative.map((value, index) => `${index ? 'L' : 'M'}${center(index)},${scale.y(value)}`)
	);
	const area = $derived(
		line.length > 1
			? `${line.join('')}L${center(line.length - 1)},${scale.y(0)}L${center(0)},${scale.y(0)}Z`
			: ''
	);

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
		{#if cumulative.length > 1}<span><i class="swatch net"></i>Überschuss aufgelaufen</span>{/if}
	</div>
	<p class="readout" aria-hidden="true">
		{#if shown && active !== null}
			<strong>{shown.title}:</strong>
			{formatCents(shown.received)} ein, {formatCents(shown.expenses)} aus{#if active < cumulative.length},
				bis dahin {formatCents(cumulative[active])} Überschuss{/if}
		{:else}
			Zeige auf einen Zeitraum für die Beträge.
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
			{#if area}<path class="net-area" d={area} />{/if}
			{#each points as point, index (point.key)}
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
						x={center(index) - slot / 2}
						y={padding.top}
						width={slot}
						height={plotHeight}
					/>
					<path class="bar income" d={bar(center(index) - barWidth - 1, point.received)} />
					<path class="bar expense" d={bar(center(index) + 1, point.expenses)} />
					{#if index % labelEvery === 0}
						<text class="axis" x={center(index)} y={height - 6} text-anchor="middle"
							>{point.label}</text
						>
					{/if}
				</g>
			{/each}
			{#if line.length > 1}
				<path class="net-line" d={line.join('')} />
				{#each cumulative as value, index (index)}
					<circle
						class="net-dot"
						class:active={active === index}
						cx={center(index)}
						cy={scale.y(value)}
						r={active === index ? 5 : 3.5}
					/>
				{/each}
			{/if}
		</svg>
	</div>
</figure>

<style>
	.flow-chart {
		margin: 0;
		display: grid;
		gap: 0.25rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		align-items: center;
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
	.swatch.income {
		background: var(--color-chart-income);
	}
	.swatch.expense {
		background: var(--color-chart-expense);
	}
	.swatch.net {
		background: var(--color-chart-net);
		box-shadow: inset 0 0 0 1.5px var(--color-text);
	}
	.bar {
		stroke: var(--color-surface);
		stroke-width: 1.5;
	}
	.bar.income {
		fill: var(--color-chart-income);
	}
	.bar.expense {
		fill: var(--color-chart-expense);
	}
	/* On a dark surface the neon turns olive under transparency; a faint tint keeps it yellow. */
	.net-area {
		fill: light-dark(
			color-mix(in srgb, var(--color-chart-net) 28%, transparent),
			color-mix(in srgb, var(--color-chart-net) 12%, transparent)
		);
	}
	.net-line {
		fill: none;
		stroke: var(--color-text);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
		pointer-events: none;
	}
	.net-dot {
		fill: var(--color-chart-net);
		stroke: var(--color-text);
		stroke-width: 1.5;
		pointer-events: none;
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
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.hit {
		fill: transparent;
	}
	.period {
		outline: none;
		cursor: default;
	}
	.period:hover .hit,
	.period:focus-visible .hit {
		fill: var(--color-hover);
		opacity: 0.6;
	}
	.period.dim .bar {
		opacity: 0.35;
	}
	@media print {
		.net-area {
			fill: color-mix(in srgb, var(--color-chart-net) 50%, transparent);
		}
	}
</style>
