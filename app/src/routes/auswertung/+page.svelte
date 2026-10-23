<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FlowChart from '#lib/components/FlowChart.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { formatArea, formatNumber, pluralize } from '#lib/format.ts';
	import { expenseCategoryLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const all = $derived(data.period === 'all');
	const periodLabel = $derived(all ? 'seit Beginn' : String(data.period));

	const points = $derived(
		data.series.map((point) => ({
			...point,
			label: all ? point.key : formatMonth(point.key).slice(0, 3),
			title: all ? point.key : formatMonth(point.key)
		}))
	);

	function percent(value: number | null): string {
		return value === null ? '–' : `${formatNumber(value * 100, 1)} %`;
	}

	const perSqmFormat = new Intl.NumberFormat('de-DE', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});

	function perSqm(value: number | null): string {
		return value === null ? '–' : `${perSqmFormat.format(value)} €/m²`;
	}

	// The unit table sorts by the column the user picks; by default the most expensive first.
	type UnitRow = (typeof data.units)[number];
	const unitSorts = {
		expenses: { label: 'Ausgaben', value: (row: UnitRow) => row.expenses },
		net: { label: 'Überschuss', value: (row: UnitRow) => row.net },
		received: { label: 'Eingang', value: (row: UnitRow) => row.received },
		rentPerSqm: { label: 'Kaltmiete pro m²', value: (row: UnitRow) => row.rentPerSqm ?? -1 },
		vacantDays: { label: 'Leerstand', value: (row: UnitRow) => row.vacantDays }
	} as const;
	let unitSort = $state<keyof typeof unitSorts>('expenses');
	const sortedUnits = $derived(
		[...data.units].sort((a, b) => unitSorts[unitSort].value(b) - unitSorts[unitSort].value(a))
	);

	const categoryMax = $derived(Math.max(1, ...data.byCategory.map((row) => Math.abs(row.amount))));
	const hasData = $derived(
		data.totals.charged !== 0 || data.totals.received !== 0 || data.totals.expenses !== 0
	);
</script>

<form method="GET" class="toolbar filters">
	<label class="inline">
		Zeitraum
		<select name="jahr" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
			{#each data.years as year (year)}
				<option value={String(year)} selected={data.period === year}>{year}</option>
			{/each}
			<option value="gesamt" selected={all}>Gesamt</option>
		</select>
	</label>
	{#if data.propertyOptions.length > 1}
		<label class="inline">
			Objekt
			<select name="objekt" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				<option value="" selected={!data.propertyId}>alle Objekte</option>
				{#each data.propertyOptions as property (property.id)}
					<option value={property.id} selected={data.propertyId === property.id}>
						{property.name}
					</option>
				{/each}
			</select>
		</label>
	{/if}
	<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
</form>

{#if data.units.length === 0}
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
			<span class="label">
				Einnahmen {periodLabel} · von <Money cents={data.totals.charged} /> Soll ({percent(
					data.totals.collectionRate
				)})
			</span>
		</li>
		<li class="card tile">
			<span class="value"><Money cents={data.totals.expenses} /></span>
			<span class="label">Ausgaben {periodLabel}</span>
		</li>
		<li class="card tile">
			<span class="value" class:negative={data.totals.net < 0}>
				<Money cents={data.totals.net} signed />
			</span>
			<span class="label">Überschuss {periodLabel} · Einnahmen minus Ausgaben</span>
		</li>
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
			<span class="value">{perSqm(data.totals.rentPerSqm)}</span>
			<span class="label">
				Ø Kaltmiete pro Monat · {pluralize(
					data.totals.unitCount,
					'Einheit',
					'Einheiten'
				)}{#if data.totals.floorArea > 0},
					{formatArea(data.totals.floorArea)}{/if}
			</span>
		</li>
		<li class="card tile">
			<a href="/mietkonto?filter=rueckstaende">
				<span class="value" class:negative={data.arrears > 0}><Money cents={data.arrears} /></span>
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
					label="Einnahmen und Ausgaben {all ? 'je Jahr' : `je Monat ${data.period}`}"
				/>
			</div>
			<details class="as-table">
				<summary>Als Tabelle</summary>
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>{all ? 'Jahr' : 'Monat'}</th>
								<th class="number">Soll</th>
								<th class="number">Einnahmen</th>
								<th class="number">Ausgaben</th>
								<th class="number">Überschuss</th>
							</tr>
						</thead>
						<tbody>
							{#each data.series as point (point.key)}
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
		{#if data.byCategory.length === 0}
			<p class="muted">
				Keine Ausgaben in diesem Zeitraum. Ordne ausgehende Umsätze unter
				<a href="/bank">Bank</a> als Ausgabe zu oder erfasse sie unter
				<a href="/auswertung/ausgaben">Ausgaben</a>.
			</p>
		{:else}
			<div class="split">
				<ul class="card bars" aria-label="Ausgaben nach Kategorie">
					{#each data.byCategory as row (row.category)}
						<li>
							<span class="bar-label">{expenseCategoryLabels[row.category]}</span>
							<span class="bar-track" aria-hidden="true">
								<span class="bar-fill" style:width="{(Math.abs(row.amount) / categoryMax) * 100}%"
								></span>
							</span>
							<span class="bar-value"><Money cents={row.amount} /></span>
						</li>
					{/each}
				</ul>
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
			<h2 id="properties">Objekte im Vergleich</h2>
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Objekt</th>
							<th class="number">Einheiten</th>
							<th class="number">Einnahmen</th>
							<th class="number">Ausgaben</th>
							<th class="number">Überschuss</th>
							<th class="number">Kaltmiete pro m²</th>
							<th class="number">Leerstand</th>
						</tr>
					</thead>
					<tbody>
						{#each data.properties as row (row.id)}
							<tr>
								<td
									><a href="?jahr={all ? 'gesamt' : data.period}&objekt={row.id}">{row.name}</a></td
								>
								<td class="number">{row.unitCount}</td>
								<td class="number"><Money cents={row.received} /></td>
								<td class="number"><Money cents={row.expenses} /></td>
								<td class="number" class:negative={row.net < 0}><Money cents={row.net} signed /></td
								>
								<td class="number">{perSqm(row.rentPerSqm)}</td>
								<td class="number"
									>{percent(row.unitDays > 0 ? row.vacantDays / row.unitDays : null)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<section aria-labelledby="units">
		<div class="row between">
			<h2 id="units">Einheiten im Vergleich</h2>
			<label class="inline sort">
				Sortieren nach
				<select bind:value={unitSort}>
					{#each Object.entries(unitSorts) as [key, sort] (key)}
						<option value={key}>{sort.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<p class="muted small">
			Einnahmen zählen für die Haupteinheit des Mietvertrags. Ausgaben nur, wenn sie der Einheit
			selbst zugeordnet sind; Ausgaben für das ganze Objekt stehen oben beim Objekt.
		</p>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Einheit</th>
						<th class="number">Fläche</th>
						<th class="number">Kaltmiete (Soll)</th>
						<th class="number">Eingang</th>
						<th class="number">Ausgaben</th>
						<th class="number">Überschuss</th>
						<th class="number">pro m²</th>
						<th class="number">Leerstand</th>
					</tr>
				</thead>
				<tbody>
					{#each sortedUnits as row (row.id)}
						<tr>
							<td>
								<a href="/objekte/{row.propertyId}">{row.name}</a>
								{#if data.propertyOptions.length > 1 && !data.propertyId}
									<span class="muted small">{row.propertyName}</span>
								{/if}
							</td>
							<td class="number">{row.floorArea ? formatArea(row.floorArea) : '–'}</td>
							<td class="number"><Money cents={row.baseRent} /></td>
							<td class="number"><Money cents={row.received} /></td>
							<td class="number"><Money cents={row.expenses} /></td>
							<td class="number" class:negative={row.net < 0}><Money cents={row.net} signed /></td>
							<td class="number">{perSqm(row.rentPerSqm)}</td>
							<td class="number">
								{row.vacantDays > 0 ? pluralize(row.vacantDays, 'Tag', 'Tage') : '–'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<style>
	.filters {
		margin-bottom: 1rem;
	}
	.tiles {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
		margin: 0 0 1.5rem;
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
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.tile .label {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
	.tile a:hover .value {
		text-decoration: underline;
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
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
	}
	.bars {
		list-style: none;
		margin: 0;
		display: grid;
		gap: 0.6rem;
	}
	.bars li {
		display: grid;
		grid-template-columns: minmax(8rem, 12rem) 1fr auto;
		gap: 0.75rem;
		align-items: center;
	}
	.bar-track {
		height: 0.6rem;
		background: var(--color-hover);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar-fill {
		display: block;
		height: 100%;
		background: var(--color-chart-expense);
		border-radius: 4px;
	}
	.bar-value {
		font-variant-numeric: tabular-nums;
	}
	h3 {
		margin-top: 0;
		font-size: 1rem;
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
	.row.between {
		align-items: center;
	}
	.sort {
		white-space: nowrap;
	}
	@media (max-width: 40rem) {
		.bars li {
			grid-template-columns: 1fr auto;
		}
		.bar-track {
			grid-column: 1 / -1;
			order: 3;
		}
	}
</style>
