<script lang="ts">
	import DonutChart from '#lib/components/DonutChart.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FlowChart from '#lib/components/FlowChart.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import Sections from './Sections.svelte';
	import Sparkline from '#lib/components/Sparkline.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { formatArea, pluralize } from '#lib/format.ts';
	import { expenseCategoryLabels, expenseCategoryShortLabels } from '#lib/labels.ts';
	import Filters from './Filters.svelte';
	import { percent, perSqm } from './figures';
	import { byDate, byNumber, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const all = $derived(data.period === 'all');
	const periodLabel = $derived(all ? 'seit Beginn' : String(data.period));
	const seriesSort = new TableSort<PageProps['data']['series'][number]>({
		period: byDate((point) => point.key),
		charged: byNumber((point) => point.charged),
		received: byNumber((point) => point.received),
		expenses: byNumber((point) => point.expenses),
		net: byNumber((point) => point.net)
	});

	const points = $derived(
		data.series.map((point) => ({
			...point,
			label: all ? point.key : formatMonth(point.key).slice(0, 3),
			title: all ? point.key : formatMonth(point.key)
		}))
	);

	/** How many periods have begun: the months up to today in the current year, else all. */
	const until = $derived.by(() => {
		const current = data.today.slice(0, all ? 4 : 7);
		return data.series.filter((point) => point.key <= current).length;
	});
	const past = $derived(data.series.slice(0, until));
	const cumulative = $derived.by(() => {
		let sum = 0;
		return past.map((point) => (sum += point.net));
	});

	// Activity per period, not the sums: an expense and its refund cancel out in the totals.
	const hasData = $derived(
		data.series.some((point) => point.charged !== 0 || point.received !== 0 || point.expenses !== 0)
	);
	const largest = $derived(data.byCategory[0]);

	/** The scale of the property bars: the largest income or spending of any property. */
	const propertyMax = $derived(
		Math.max(1, ...data.properties.map((row) => Math.max(row.received, row.expenses)))
	);
	const query = $derived(
		`jahr=${all ? 'gesamt' : data.period}${data.propertyId ? `&objekt=${data.propertyId}` : ''}`
	);
</script>

<PageHeader
	title="Auswertung"
	lead="Einnahmen, Ausgaben und Leerstand deines Bestands auf einen Blick."
/>

<Sections />

<Filters
	years={data.years}
	period={data.period}
	propertyId={data.propertyId}
	propertyOptions={data.propertyOptions}
/>

<!-- Expenses can exist without units (portfolio-wide, or kept after a property was deleted). -->
{#if data.units.length === 0 && !hasData}
	<EmptyState
		title="Noch nichts auszuwerten"
		text="Sobald Einheiten, Mietverträge und Zahlungen angelegt sind, siehst du hier Einnahmen, Ausgaben und Leerstand."
	>
		<a href="/objekte">Zu den Objekten</a>
	</EmptyState>
{:else}
	<ul class="tiles" aria-label="Kennzahlen {periodLabel}">
		<li class="card tile">
			<span class="value"><Money cents={data.totals.received} /></span>
			<span class="label">Einnahmen {periodLabel}</span>
			<Sparkline values={past.map((point) => point.received)} />
			<span class="pill">
				{percent(data.totals.collectionRate)} von <Money cents={data.totals.charged} /> Soll
			</span>
		</li>
		<li class="card tile">
			<span class="value"><Money cents={data.totals.expenses} /></span>
			<span class="label">Ausgaben {periodLabel}</span>
			<Sparkline values={past.map((point) => point.expenses)} />
			{#if largest}
				<span class="pill" title={expenseCategoryLabels[largest.category]}>
					größter Posten: {expenseCategoryShortLabels[largest.category]}
				</span>
			{/if}
		</li>
		<li class="card tile">
			<span class="value">
				{#if data.totals.net >= 0}
					<mark><Money cents={data.totals.net} signed /></mark>
				{:else}
					<Money cents={data.totals.net} signed />
				{/if}
			</span>
			<span class="label">Überschuss {periodLabel}</span>
			<Sparkline values={cumulative} filled={data.totals.net >= 0} />
			<span class="pill">Einnahmen minus Ausgaben</span>
		</li>
		<li class="card tile">
			<span class="value">{perSqm(data.totals.rentPerSqm)}</span>
			<span class="label">Ø Kaltmiete pro Monat</span>
			<Sparkline
				values={past.flatMap((point) => (point.rentPerSqm === null ? [] : [point.rentPerSqm]))}
			/>
			<span class="pill">
				{pluralize(data.totals.unitCount, 'Einheit', 'Einheiten')}{#if data.totals.floorArea > 0},
					{formatArea(data.totals.floorArea)}{/if}
			</span>
		</li>
	</ul>

	<ul class="tiles small" aria-label="Bestand {periodLabel}">
		<li class="card tile">
			<span class="value">{percent(data.totals.vacancyRate)}</span>
			<span class="label">
				Leerstand · {pluralize(
					data.totals.vacantDays,
					'Tag',
					'Tage'
				)}{#if data.totals.lostRent > 0}, ca. <Money cents={data.totals.lostRent} /> Kaltmiete entgangen{/if}
			</span>
		</li>
		<li class="card tile">
			<a href="/mietkonto?filter=rueckstaende">
				<span class="value"><Balance cents={data.arrears} /></span>
				<span class="label">Rückstände heute</span>
			</a>
		</li>
		<li class="card tile">
			<span class="value"><Money cents={data.totals.depositsHeld} /></span>
			<span class="label">Kautionen, die du heute verwahrst</span>
		</li>
	</ul>

	<section aria-labelledby="flow">
		<h2 id="flow">{all ? 'Verlauf nach Jahren' : `Verlauf ${data.period}`}</h2>
		{#if hasData}
			<div class="card">
				<FlowChart
					{points}
					{until}
					label="Einnahmen und Ausgaben {all ? 'je Jahr' : `je Monat ${data.period}`}"
				/>
			</div>
			<details class="as-table">
				<summary>Als Tabelle</summary>
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<SortHeader sort={seriesSort} key="period">{all ? 'Jahr' : 'Monat'}</SortHeader>
								<SortHeader sort={seriesSort} key="charged" class="num">Soll</SortHeader>
								<SortHeader sort={seriesSort} key="received" class="num">Einnahmen</SortHeader>
								<SortHeader sort={seriesSort} key="expenses" class="num">Ausgaben</SortHeader>
								<SortHeader sort={seriesSort} key="net" class="num">Überschuss</SortHeader>
							</tr>
						</thead>
						<tbody>
							{#each seriesSort.rows(data.series) as point (point.key)}
								<tr>
									<td>{all ? point.key : formatMonth(point.key)}</td>
									<td class="number"><Money cents={point.charged} /></td>
									<td class="number"><Money cents={point.received} /></td>
									<td class="number"><Money cents={point.expenses} /></td>
									<td class="number"><Money cents={point.net} signed /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{:else}
			<p class="muted">In diesem Zeitraum gibt es keine Sollstellungen, Zahlungen oder Ausgaben.</p>
		{/if}
	</section>

	<section aria-labelledby="categories">
		<h2 id="categories">Ausgaben nach Kategorie</h2>
		{#if data.topExpenses.length === 0}
			<p class="muted">
				Keine Ausgaben in diesem Zeitraum. Ordne ausgehende Umsätze unter
				<a href="/bank">Bank</a> als Ausgabe zu oder erfasse sie unter
				<a href="/auswertung/ausgaben">Ausgaben</a>.
			</p>
		{:else}
			<div class="split">
				<div class="card">
					<DonutChart
						label="Ausgaben nach Kategorie"
						slices={data.byCategory.map((row) => ({
							key: row.category,
							label: expenseCategoryLabels[row.category],
							amount: row.amount
						}))}
					/>
				</div>
				<div class="card">
					<h3>Größte Ausgaben</h3>
					<ol class="top">
						{#each data.topExpenses as expense (expense.id)}
							<li>
								<span class="top-what">
									{expense.description}
									<span class="muted small">
										{formatDate(expense.date)} · {expenseCategoryLabels[expense.category]}
									</span>
								</span>
								<Money cents={expense.amount} />
							</li>
						{/each}
					</ol>
				</div>
			</div>
		{/if}
	</section>

	{#if data.properties.length > 1}
		<section aria-labelledby="properties">
			<div class="section-head">
				<h2 id="properties">Überschuss je Objekt</h2>
				<a href="/auswertung/vergleich?{query}">Alle Zahlen im Vergleich</a>
			</div>
			<ul class="card property-bars" aria-label="Überschuss je Objekt">
				{#each data.properties as row (row.id)}
					<li>
						<span class="property-head">
							<a href="?jahr={all ? 'gesamt' : data.period}&objekt={row.id}">{row.name}</a>
							<strong class:negative={row.net < 0}><Money cents={row.net} signed /></strong>
						</span>
						<span
							class="property-track"
							style:width="{(Math.max(row.received, row.expenses) / propertyMax) * 100}%"
							aria-hidden="true"
						>
							<span
								class="spent"
								class:over={row.net < 0}
								style:flex-basis="{(Math.min(row.expenses, row.received) /
									Math.max(row.received, row.expenses, 1)) *
									100}%"
							></span>
							{#if row.net > 0}<span class="kept"></span>{/if}
						</span>
						<span class="muted small">
							<Money cents={row.received} /> ein · <Money cents={row.expenses} /> Ausgaben · Leerstand
							{percent(row.unitDays > 0 ? row.vacantDays / row.unitDays : null)}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{:else if data.units.length > 0}
		<p><a href="/auswertung/vergleich?{query}">Einheiten im Vergleich</a></p>
	{/if}
{/if}

<style>
	.tiles {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.75rem;
		margin: 0 0 0.75rem;
	}
	.tiles.small {
		margin-bottom: 1.5rem;
	}
	.tile,
	.tile a {
		display: grid;
		gap: 0.125rem;
		align-content: start;
		text-decoration: none;
		color: inherit;
	}
	.tile .value {
		font-size: var(--text-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.tiles.small .value {
		font-size: var(--text-lg);
	}
	.tile .label {
		color: var(--color-muted);
		font-size: var(--text-base);
	}
	.tile a:hover .value {
		text-decoration: underline;
	}
	mark {
		padding: 0 0.2em;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	mark :global(.money) {
		color: inherit;
	}
	.pill {
		justify-self: start;
		max-width: 100%;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		margin-top: 0.6rem;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--color-hover);
		font-size: var(--text-xs);
		font-weight: 500;
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
	.split {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
	}
	h3 {
		margin-top: 0;
		font-size: var(--text-base);
	}
	.top {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.5rem;
	}
	.top li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.top-what {
		display: grid;
		overflow-wrap: anywhere;
	}
	.section-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.25rem 1rem;
	}
	.property-bars {
		list-style: none;
		margin: 0;
		display: grid;
		gap: 1.1rem;
	}
	.property-bars li {
		display: grid;
		gap: 0.35rem;
	}
	.property-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.property-track {
		display: flex;
		gap: 2px;
		height: 0.8rem;
		min-width: 0.5rem;
	}
	.spent {
		flex: 0 0 auto;
		background: var(--color-chart-expense);
		border-radius: 3px;
	}
	.spent.over {
		flex-basis: 100% !important;
		background: var(--color-danger);
	}
	.kept {
		flex: 1;
		background: var(--color-chart-net);
		border-radius: 3px;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-chart-net), #000 18%);
	}
</style>
