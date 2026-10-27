<script lang="ts">
	// One row per kind of cost: the own figure as a bar, the reference as a mark across it, both
	// per m² and month. A row above the reference says by how much, in red from a fifth above; the
	// table on the page has the same numbers.

	type Row = { label: string; value: number | null; reference: number };
	let { rows, label }: { rows: Row[]; label: string } = $props();

	const max = $derived(
		Math.max(1, ...rows.flatMap((row) => [row.value ?? 0, row.reference])) * 1.08
	);
	const position = (cents: number) => `${(cents / max) * 100}%`;
	const euros = (cents: number) =>
		(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	/** Percent above the reference, from 5 % on. */
	function above(row: Row): number | null {
		if (row.value === null || row.reference === 0 || row.value <= row.reference * 1.05) return null;
		return Math.round((row.value / row.reference - 1) * 100);
	}
</script>

<figure class="benchmark-chart" aria-label={label}>
	<ul>
		{#each rows as row (row.label)}
			{@const percent = above(row)}
			<li>
				<span class="label">{row.label}</span>
				<span class="track" aria-hidden="true">
					{#if row.value}
						<span class="bar" style:width={position(row.value)}></span>
					{/if}
					<span class="reference" style:left={position(row.reference)}></span>
				</span>
				<span class="figures">
					<strong>{row.value === null ? '–' : euros(row.value)} €</strong>
					<span class="muted">Ø {euros(row.reference)} €</span>
					{#if percent !== null}
						<span class="difference" class:high={percent >= 20}>+{percent} %</span>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
	<figcaption class="legend muted small">
		<span><span class="swatch bar-swatch"></span> deine Kosten je m² im Monat</span>
		<span><span class="swatch reference-swatch"></span> Mieterbund-Durchschnitt</span>
	</figcaption>
</figure>

<style>
	.benchmark-chart {
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.625rem;
	}
	li {
		display: grid;
		grid-template-columns: minmax(9rem, 14rem) 1fr minmax(11rem, auto);
		gap: 0.75rem;
		align-items: center;
		font-size: var(--text-base);
	}
	.track {
		position: relative;
		height: 1.125rem;
		background: var(--color-hover);
		border-radius: 4px;
	}
	.bar {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--color-chart-income);
		border-radius: 4px;
	}
	.reference {
		position: absolute;
		top: -0.25rem;
		bottom: -0.25rem;
		width: 3px;
		margin-left: -1.5px;
		background: var(--color-chart-net);
		outline: 1px solid color-mix(in srgb, var(--color-chart-net), #000 25%);
		border-radius: 2px;
	}
	.figures {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.difference {
		color: var(--color-muted);
	}
	.difference.high {
		color: var(--color-danger);
		font-weight: 600;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 1rem;
	}
	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 2px;
		vertical-align: -0.1em;
	}
	.bar-swatch {
		background: var(--color-chart-income);
	}
	.reference-swatch {
		width: 3px;
		background: var(--color-chart-net);
		outline: 1px solid color-mix(in srgb, var(--color-chart-net), #000 25%);
	}
	@media (max-width: 40rem) {
		li {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
