<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatArea, pluralize } from '#lib/format.ts';
	import Filters from '../Filters.svelte';
	import { percent, perSqm } from '../figures';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const all = $derived(data.period === 'all');

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
</script>

<PageHeader
	title="Objekte im Vergleich"
	lead="Einnahmen, Ausgaben, Kaltmiete und Leerstand je Objekt und Einheit."
/>

<Filters
	years={data.years}
	period={data.period}
	propertyId={data.propertyId}
	propertyOptions={data.propertyOptions}
/>

{#if data.units.length === 0}
	<EmptyState
		title="Noch keine Einheiten"
		text="Sobald Objekte mit Einheiten angelegt sind, vergleichst du hier ihre Zahlen."
	>
		<a href="/objekte">Zu den Objekten</a>
	</EmptyState>
{:else}
	{#if data.properties.length > 1}
		<section aria-labelledby="properties">
			<h2 id="properties">Objekte</h2>
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
			<h2 id="units">Einheiten</h2>
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
	.negative {
		color: var(--color-danger);
	}
	section {
		margin-bottom: 1.5rem;
	}
	.number {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.row.between {
		align-items: center;
	}
	.sort {
		white-space: nowrap;
	}
</style>
