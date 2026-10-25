<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Sections from '../Sections.svelte';
	import RentChart from '#lib/components/RentChart.svelte';
	import Sparkline from '#lib/components/Sparkline.svelte';
	import Filters from '../Filters.svelte';
	import { percent, perSqm } from '../figures';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const currentYear = $derived(data.today.slice(0, 4));
	/** From the first year anything was charged: the years before only hold expenses. */
	const series = $derived.by(() => {
		const first = data.series.findIndex((point) => point.charged !== 0 || point.received !== 0);
		return first < 0 ? [] : data.series.slice(first).filter((point) => point.key <= currentYear);
	});
	const points = $derived(
		series.map((point) => ({
			...point,
			label: point.key === currentYear ? `${point.key} bis heute` : point.key
		}))
	);
	const thisYear = $derived(series.find((point) => point.key === currentYear));

	/** The Kaltmiete per m² of this year against the first year with rent per m². */
	const rent = $derived.by(() => {
		const withArea = series.filter((point) => point.rentPerSqm !== null);
		const [first, last] = [withArea[0], withArea[withArea.length - 1]];
		if (!last) return null;
		const change =
			first !== last ? { since: first.key, rate: last.rentPerSqm! / first.rentPerSqm! - 1 } : null;
		return { key: last.key, perSqm: last.rentPerSqm, change };
	});

	const share = $derived(
		thisYear && thisYear.charged > 0
			? Math.min(1, Math.max(0, thisYear.received / thisYear.charged))
			: null
	);
</script>

<PageHeader
	title="Mieteinnahmen"
	lead="Was du verlangt hast und was angekommen ist, über die Jahre."
/>

<Sections />

<Filters
	years={[]}
	period={data.period}
	propertyId={data.propertyId}
	propertyOptions={data.propertyOptions}
/>

{#if series.length === 0}
	<EmptyState
		title="Noch keine Mieteinnahmen"
		text="Sobald Mietverträge laufen und Zahlungen eingehen, siehst du hier, wie sich deine Mieteinnahmen entwickeln."
	>
		<a href="/vertraege">Zu den Mietverträgen</a>
	</EmptyState>
{:else}
	<ul class="tiles" aria-label="Mieteinnahmen in Zahlen">
		{#if thisYear}
			<li class="card tile wide">
				<span class="value">
					<Money cents={thisYear.received} />
					<span class="value-note">eingegangen {currentYear}</span>
				</span>
				<span class="label">von <Money cents={thisYear.charged} /> Soll bis heute</span>
				{#if share !== null}
					<span class="progress" aria-hidden="true">
						<span class="paid" style:flex-basis="{share * 100}%"></span>
						{#if share < 1}<span class="open"></span>{/if}
					</span>
					<span class="progress-legend">
						<span>{percent(share)} eingegangen</span>
						{#if data.arrears > 0}
							<a class="negative" href="/mietkonto?filter=rueckstaende">
								<Money cents={data.arrears} /> Rückstand heute
							</a>
						{/if}
					</span>
				{/if}
			</li>
		{/if}
		{#if rent}
			<li class="card tile">
				<span class="value">{perSqm(rent.perSqm)}</span>
				<span class="label">Ø Kaltmiete pro m² und Monat {rent.key}</span>
				{#if rent.change}
					<span class="change">
						{#if rent.change.rate > 0}
							<mark>+{percent(rent.change.rate)}</mark>
						{:else}
							{percent(rent.change.rate)}
						{/if}
						seit {rent.change.since}
					</span>
				{/if}
			</li>
		{/if}
		<li class="card tile">
			<span class="value">{percent(data.totals.collectionRate)}</span>
			<span class="label">der Sollmiete eingegangen, seit {series[0].key}</span>
		</li>
	</ul>

	<section aria-labelledby="years">
		<h2 id="years">Soll und Ist je Jahr</h2>
		<div class="card">
			<RentChart {points} label="Verlangte und eingegangene Miete je Jahr" />
		</div>
		<details class="as-table">
			<summary>Als Tabelle</summary>
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Jahr</th>
							<th class="number">Kaltmiete</th>
							<th class="number">Soll</th>
							<th class="number">Eingegangen</th>
							<th class="number">Quote</th>
						</tr>
					</thead>
					<tbody>
						{#each points as point (point.key)}
							<tr>
								<td>{point.label}</td>
								<td class="number"><Money cents={point.baseRent} /></td>
								<td class="number"><Money cents={point.charged} /></td>
								<td class="number"><Money cents={point.received} /></td>
								<td class="number"
									>{percent(point.charged > 0 ? point.received / point.charged : null)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	</section>

	{#if data.propertySeries.length > 1}
		<section aria-labelledby="per-property">
			<h2 id="per-property">Je Objekt</h2>
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Objekt</th>
							<th class="trend">Eingegangen seit {series[0].key}</th>
							<th class="number">{currentYear} bis heute</th>
							<th class="number">Kaltmiete {currentYear}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.propertySeries as row (row.id)}
							{@const own = row.series.filter(
								(point) => point.key >= series[0].key && point.key <= currentYear
							)}
							{@const now = own.find((point) => point.key === currentYear)}
							<tr>
								<td><a href="?objekt={row.id}">{row.name}</a></td>
								<td class="trend"><Sparkline values={own.map((point) => point.received)} /></td>
								<td class="number"><Money cents={now?.received ?? 0} /></td>
								<td class="number"><Money cents={now?.baseRent ?? 0} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
{/if}

<style>
	.tiles {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
		margin: 0 0 1.5rem;
	}
	.tile {
		display: grid;
		gap: 0.125rem;
		align-content: start;
	}
	@media (min-width: 60rem) {
		.tile.wide {
			grid-column: span 2;
		}
	}
	.tile .value {
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.value-note {
		font-size: 0.9rem;
		font-weight: 400;
		color: var(--color-muted);
		letter-spacing: 0;
	}
	.tile .label {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
	.change {
		margin-top: 0.6rem;
		font-size: 0.9rem;
		font-weight: 500;
	}
	mark {
		padding: 0 0.2em;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	.progress {
		display: flex;
		gap: 2px;
		height: 0.75rem;
		margin-top: 0.75rem;
	}
	.paid {
		flex: 0 0 auto;
		background: var(--color-chart-income);
		border-radius: 3px;
	}
	.open {
		flex: 1;
		border-radius: 3px;
		background: repeating-linear-gradient(
			45deg,
			var(--color-danger-subtle) 0 4px,
			var(--color-danger-border) 4px 6px
		);
	}
	.progress-legend {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-muted);
	}
	.negative {
		color: var(--color-danger);
	}
	section {
		margin-bottom: 1.5rem;
	}
	.as-table {
		margin-top: 0.5rem;
	}
	.number {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.trend {
		width: 40%;
	}
	.trend :global(.sparkline) {
		margin: 0;
		max-width: 16rem;
	}
</style>
