<script lang="ts">
	import BenchmarkChart from '#lib/components/BenchmarkChart.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Sections from '../Sections.svelte';
	import { benchmarkSource, referenceTotal } from '#lib/domain/cost-benchmark.ts';
	import { formatNumber } from '#lib/format.ts';
	import { perSqm } from '../figures';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Cents per m² and month as €/m². */
	const cents = (value: number | null) => perSqm(value === null ? null : value / 100);
	const difference = $derived(
		data.perSqm === null ? null : Math.round((data.perSqm / referenceTotal - 1) * 100)
	);
	const chartRows = $derived(
		data.rows.map((row) => ({ label: row.label, value: row.perSqm, reference: row.reference }))
	);
</script>

<PageHeader
	title="Nebenkosten-Vergleich"
	lead="Deine umlagefähigen Betriebskosten je m² neben dem Durchschnitt aus dem Betriebskostenspiegel des Mieterbunds."
/>

<Sections />

{#if data.years.length === 0}
	<EmptyState
		title="Noch keine Betriebskosten erfasst"
		text="Sobald Belege in den Kostenarten der Betriebskostenverordnung erfasst sind, vergleicht diese Seite sie mit dem Durchschnitt."
	>
		<a href="/betriebskosten/belege">Zu den Belegen</a>
	</EmptyState>
{:else}
	<form method="GET" class="toolbar filters">
		<label class="inline">
			Jahr
			<select name="jahr" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				{#each data.years as year (year)}
					<option value={String(year)} selected={data.year === year}>{year}</option>
				{/each}
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

	<ul class="tiles" aria-label="Nebenkosten {data.year}">
		<li class="card tile">
			<span class="value">{cents(data.perSqm)}</span>
			<span class="label">deine Betriebskosten im Monat</span>
			<span class="note">
				{#if data.area > 0}
					<Money cents={data.amount} /> im Jahr auf {formatNumber(data.area, 1)} m²
				{:else}
					ohne Wohnfläche nicht je m² zu rechnen
				{/if}
			</span>
		</li>
		<li class="card tile">
			<span class="value">{cents(referenceTotal)}</span>
			<span class="label">Durchschnitt in Deutschland</span>
			<span class="note">alle Kostenarten, Abrechnungsjahr {benchmarkSource.year}</span>
		</li>
		<li class="card tile">
			<span class="value" class:above={difference !== null && difference > 5}>
				{#if difference === null}
					–
				{:else if difference <= -5}
					<mark>{difference} %</mark>
				{:else}
					{difference > 0 ? '+' : ''}{difference} %
				{/if}
			</span>
			<span class="label">gegenüber dem Durchschnitt</span>
			<span class="note">
				{#if difference === null}
					–
				{:else if difference > 5}
					teurer als üblich, ein Blick auf die Kostenarten lohnt
				{:else if difference < -5}
					günstiger als üblich
				{:else}
					im üblichen Rahmen
				{/if}
			</span>
		</li>
	</ul>

	{#if data.withoutArea.length}
		<p class="muted small">
			Ohne Wohnfläche nicht mitgerechnet: {data.withoutArea.join(', ')}. Trag die Fläche der
			Einheiten unter Objekte ein.
		</p>
	{/if}

	{#if data.area > 0}
		<section aria-labelledby="by-kind">
			<h2 id="by-kind">Je Kostenart · {data.year}</h2>
			<div class="card">
				<BenchmarkChart
					rows={chartRows}
					label="Betriebskosten je m² im Monat neben dem Durchschnitt"
				/>
			</div>
			<details class="as-table">
				<summary>Als Tabelle</summary>
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>Kostenart</th>
								<th class="number">im Jahr</th>
								<th class="number">je m² im Monat</th>
								<th class="number">Durchschnitt</th>
							</tr>
						</thead>
						<tbody>
							{#each data.rows as row (row.key)}
								<tr>
									<td>{row.label}</td>
									<td class="number"><Money cents={row.amount} /></td>
									<td class="number">{cents(row.perSqm)}</td>
									<td class="number">{cents(row.reference)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
			<p class="muted small">
				Eine Kostenart ohne Belege steht bei 0; das ist oft richtig (kein Aufzug), manchmal fehlt
				nur der Beleg. Heizkosten schwanken stark mit Energieträger, Baujahr und Winter. Antenne und
				Kabel sind seit Juli 2024 nicht mehr umlagefähig.
			</p>
		</section>
	{/if}

	{#if data.properties.length > 1}
		<section aria-labelledby="per-property">
			<h2 id="per-property">Je Objekt</h2>
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Objekt</th>
							<th class="number">Fläche</th>
							<th class="number">im Jahr</th>
							<th class="number">je m² im Monat</th>
						</tr>
					</thead>
					<tbody>
						{#each data.properties as row (row.id)}
							<tr>
								<td><a href="?jahr={data.year}&objekt={row.id}">{row.name}</a></td>
								<td class="number">{row.area > 0 ? `${formatNumber(row.area, 1)} m²` : '–'}</td>
								<td class="number"><Money cents={row.amount} /></td>
								<td class="number" class:above={row.perSqm !== null && row.perSqm > referenceTotal}>
									{cents(row.perSqm)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<p class="muted small source">
		Quelle: <a href={benchmarkSource.url} target="_blank" rel="noopener noreferrer"
			>{benchmarkSource.name}, Abrechnungsjahr {benchmarkSource.year}</a
		>. Bundesweite Durchschnittswerte; der Hauswart ist der Wert neben eigens abgerechneter
		Reinigung und Gartenpflege.
	</p>
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
		margin: 0 0 0.75rem;
	}
	.tile {
		display: grid;
		gap: 0.125rem;
		align-content: start;
	}
	.tile .value {
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.tile .label {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
	.tile .note {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: var(--color-muted);
	}
	mark {
		padding: 0 0.2em;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	.above {
		color: var(--color-danger);
	}
	section {
		margin: 1.5rem 0;
	}
	.as-table {
		margin-top: 0.5rem;
	}
	.number {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.source {
		margin-top: 2rem;
	}
</style>
