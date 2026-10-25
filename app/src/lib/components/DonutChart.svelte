<script lang="ts">
	import Money from './Money.svelte';

	// Shares of a whole as a ring, with the largest share in its middle and every slice listed
	// with its amount beside it. Up to four slices get their own shade; the rest fold into
	// "Sonstige", so a shade never has to be told apart from a fifth. Negative amounts (a refund
	// larger than the costs of its category) have no place in a ring and count as zero there;
	// the list still shows them.

	type Slice = { key: string; label: string; amount: number };
	let { slices, label }: { slices: Slice[]; label: string } = $props();

	const shades = 4;

	const shown = $derived.by(() => {
		const sorted = [...slices].sort((a, b) => b.amount - a.amount);
		if (sorted.length <= shades) return sorted;
		const rest = sorted.slice(shades - 1);
		return [
			...sorted.slice(0, shades - 1),
			{
				key: 'rest',
				label: `Sonstige (${rest.length})`,
				amount: rest.reduce((sum, slice) => sum + slice.amount, 0)
			}
		];
	});

	const total = $derived(shown.reduce((sum, slice) => sum + Math.max(0, slice.amount), 0));

	const size = 160;
	const radius = 62;
	const stroke = 22;
	const circumference = 2 * Math.PI * radius;
	/** A gap of the surface colour between two slices, in px along the ring. */
	const gap = 3;

	const arcs = $derived.by(() => {
		let offset = 0;
		return shown.map((slice, index) => {
			const length = total > 0 ? (Math.max(0, slice.amount) / total) * circumference : 0;
			const arc = {
				index,
				dash: `${Math.max(0, length - (shown.length > 1 ? gap : 0))} ${circumference}`,
				offset: -offset
			};
			offset += length;
			return arc;
		});
	});

	const lead = $derived(shown[0]);
	const leadShare = $derived(
		lead && total > 0 ? Math.round((Math.max(0, lead.amount) / total) * 100) : null
	);
</script>

<div class="donut">
	<svg viewBox="0 0 {size} {size}" aria-hidden="true">
		<circle class="track" cx={size / 2} cy={size / 2} r={radius} />
		<g transform="rotate(-90 {size / 2} {size / 2})">
			{#each arcs as arc (arc.index)}
				<circle
					class="slice shade-{arc.index + 1}"
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke-width={stroke}
					stroke-dasharray={arc.dash}
					stroke-dashoffset={arc.offset}
				/>
			{/each}
		</g>
		{#if leadShare !== null}
			<text class="share" x={size / 2} y={size / 2 + 2} text-anchor="middle">{leadShare} %</text>
			<text class="share-label" x={size / 2} y={size / 2 + 20} text-anchor="middle">
				größter Posten
			</text>
		{/if}
	</svg>
	<ul aria-label={label}>
		{#each shown as slice, index (slice.key)}
			<li>
				<span><i class="swatch shade-{index + 1}"></i>{slice.label}</span>
				<span class="amount"><Money cents={slice.amount} /></span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.donut {
		display: grid;
		grid-template-columns: 9.5rem 1fr;
		gap: 1.5rem;
		align-items: center;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.track {
		fill: none;
		stroke: var(--color-hover);
		stroke-width: 22;
	}
	.slice {
		fill: none;
	}
	.slice.shade-1 {
		stroke: var(--color-chart-1);
	}
	.slice.shade-2 {
		stroke: var(--color-chart-2);
	}
	.slice.shade-3 {
		stroke: var(--color-chart-3);
	}
	.slice.shade-4 {
		stroke: var(--color-chart-4);
	}
	.share {
		fill: var(--color-text);
		font-size: 22px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.share-label {
		fill: var(--color-muted);
		font-size: 11px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.95rem;
	}
	.amount {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.swatch {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 3px;
		margin-right: 0.5rem;
		vertical-align: -0.05rem;
	}
	.swatch.shade-1 {
		background: var(--color-chart-1);
	}
	.swatch.shade-2 {
		background: var(--color-chart-2);
	}
	.swatch.shade-3 {
		background: var(--color-chart-3);
	}
	.swatch.shade-4 {
		background: var(--color-chart-4);
	}
	@media (max-width: 30rem) {
		.donut {
			grid-template-columns: 1fr;
			justify-items: center;
		}
		svg {
			max-width: 10rem;
		}
		ul {
			width: 100%;
		}
	}
</style>
