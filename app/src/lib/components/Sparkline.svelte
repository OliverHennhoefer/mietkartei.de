<script lang="ts">
	// A small trend line under a figure: the shape only, without axis or numbers. The figure next to
	// it carries the value, so the line stays hidden from screen readers. `filled` lays the neon of
	// the logo under the line, for the one figure a page wants to stand out.
	let { values, filled = false }: { values: number[]; filled?: boolean } = $props();

	const width = 200;
	const height = 36;
	const inset = 4;

	const shape = $derived.by(() => {
		if (values.length < 2) return null;
		const max = Math.max(...values);
		const min = Math.min(0, ...values);
		const span = max - min || 1;
		const x = (index: number) => inset + ((width - 2 * inset) * index) / (values.length - 1);
		const y = (value: number) => inset + (height - 2 * inset) * (1 - (value - min) / span);
		const line = values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`);
		const last = values.length - 1;
		return {
			line: line.join(''),
			area: `${line.join('')}L${x(last)},${height}L${x(0)},${height}Z`
		};
	});
</script>

{#if shape}
	<svg
		class="sparkline"
		viewBox="0 0 {width} {height}"
		preserveAspectRatio="none"
		aria-hidden="true"
	>
		{#if filled}<path class="area" d={shape.area} />{/if}
		<path class="line" d={shape.line} vector-effect="non-scaling-stroke" />
	</svg>
{/if}

<style>
	.sparkline {
		display: block;
		width: 100%;
		height: 2.25rem;
		margin-top: 0.5rem;
	}
	.line {
		fill: none;
		stroke: var(--color-text);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.area {
		fill: var(--color-chart-net);
		opacity: 0.6;
	}
	@media (prefers-color-scheme: dark) {
		.area {
			opacity: 0.25;
		}
	}
</style>
