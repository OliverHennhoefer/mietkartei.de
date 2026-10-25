<script lang="ts">
	import { formatCents } from '#lib/money.ts';

	// From the money received down to the cashflow, as steps: each cost hangs from where the one
	// before left off, and the last bar is what is left. The repayment is hatched, since it builds
	// up equity rather than being spent. Every step carries its amount; the table on the page has
	// the same numbers.

	type Step = { label: string; amount: number; kind: 'in' | 'out' | 'saving' | 'result' };
	let { steps, label }: { steps: Step[]; label: string } = $props();

	const width = 720;
	const height = 260;
	const padding = { top: 24, right: 8, bottom: 40, left: 64 };
	const plotWidth = width - padding.left - padding.right;
	const plotHeight = height - padding.top - padding.bottom;

	/** Where each bar starts and ends, running down from the money received. */
	const bars = $derived.by(() => {
		let level = 0;
		return steps.map((step) => {
			if (step.kind === 'in') {
				level = step.amount;
				return { ...step, from: 0, to: step.amount };
			}
			if (step.kind === 'result') return { ...step, from: 0, to: step.amount };
			const from = level;
			level -= step.amount;
			return { ...step, from, to: level };
		});
	});

	function niceStep(range: number): number {
		const rough = range / 4;
		const power = 10 ** Math.floor(Math.log10(rough));
		const factor = rough / power;
		return (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10) * power;
	}

	const scale = $derived.by(() => {
		const values = bars.flatMap((bar) => [bar.from, bar.to]);
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

	const slot = $derived(plotWidth / Math.max(steps.length, 1));
	const barWidth = $derived(Math.min(110, slot * 0.66));
	const left = (index: number) => padding.left + slot * index + (slot - barWidth) / 2;

	function axisLabel(cents: number): string {
		const euros = cents / 100;
		if (Math.abs(euros) >= 10_000) return `${Math.round(euros / 1000)} T€`;
		return `${Math.round(euros).toLocaleString('de-DE')} €`;
	}

	function amountLabel(bar: (typeof bars)[number]): string {
		const sign = bar.kind === 'out' || bar.kind === 'saving' ? '−' : bar.amount < 0 ? '−' : '';
		return `${sign}${formatCents(Math.abs(bar.amount))}`;
	}
</script>

<figure class="cashflow-chart">
	<div class="plot">
		<svg viewBox="0 0 {width} {height}" role="img" aria-label={label}>
			<defs>
				<pattern
					id="cashflow-hatch"
					width="6"
					height="6"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<rect class="hatch-ground" width="6" height="6" />
					<line class="hatch-line" x1="0" y1="0" x2="0" y2="6" />
				</pattern>
			</defs>
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
			{#each bars as bar, index (bar.label)}
				{@const top = Math.min(scale.y(bar.from), scale.y(bar.to))}
				{@const bottom = Math.max(scale.y(bar.from), scale.y(bar.to))}
				{#if index > 0 && bar.kind !== 'result'}
					<line
						class="connector"
						x1={left(index - 1) + barWidth}
						x2={left(index)}
						y1={scale.y(bar.from)}
						y2={scale.y(bar.from)}
					/>
				{/if}
				<rect
					class="bar {bar.kind}"
					class:negative={bar.kind === 'result' && bar.amount < 0}
					x={left(index)}
					y={top}
					width={barWidth}
					height={Math.max(1, bottom - top)}
					rx="4"
				/>
				<text class="value" x={left(index) + barWidth / 2} y={top - 8} text-anchor="middle">
					{amountLabel(bar)}
				</text>
				<text class="axis step" x={left(index) + barWidth / 2} y={height - 18} text-anchor="middle">
					{bar.label}
				</text>
			{/each}
		</svg>
	</div>
</figure>

<style>
	.cashflow-chart {
		margin: 0;
	}
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
	}
	.grid.zero {
		stroke: var(--color-muted);
	}
	.axis {
		fill: var(--color-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.axis.step {
		font-size: 12px;
	}
	.value {
		fill: var(--color-text);
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.connector {
		stroke: var(--color-muted);
		stroke-dasharray: 3 3;
		opacity: 0.6;
	}
	.bar.in {
		fill: var(--color-chart-income);
	}
	.bar.out {
		fill: var(--color-chart-expense);
	}
	.bar.saving {
		fill: url(#cashflow-hatch);
	}
	.hatch-ground {
		fill: var(--color-hover);
	}
	.hatch-line {
		stroke: var(--color-chart-expense);
		stroke-width: 2;
	}
	.bar.result {
		fill: var(--color-chart-net);
		stroke: color-mix(in srgb, var(--color-chart-net), #000 18%);
	}
	.bar.result.negative {
		fill: var(--color-danger);
		stroke: none;
	}
</style>
