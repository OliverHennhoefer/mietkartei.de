<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import Sections from '../Sections.svelte';
	import { formatArea, pluralize } from '#lib/format.ts';
	import Filters from '../Filters.svelte';
	import { percent, perSqm } from '../figures';
	import { byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const all = $derived(data.period === 'all');

	// By default the most expensive unit first.
	const units = $derived([...data.units].sort((a, b) => b.expenses - a.expenses));
	const propertySort = new TableSort<PageProps['data']['properties'][number]>({
		name: byText((row) => row.name),
		units: byNumber((row) => row.unitCount),
		received: byNumber((row) => row.received),
		expenses: byNumber((row) => row.expenses),
		net: byNumber((row) => row.net),
		rentPerSqm: byNumber((row) => row.rentPerSqm),
		vacancy: byNumber((row) => (row.unitDays > 0 ? row.vacantDays / row.unitDays : null))
	});
	const unitSort = new TableSort<PageProps['data']['units'][number]>({
		name: byText((row) => row.name),
		area: byNumber((row) => row.floorArea),
		baseRent: byNumber((row) => row.baseRent),
		received: byNumber((row) => row.received),
		expenses: byNumber((row) => row.expenses),
		net: byNumber((row) => row.net),
		rentPerSqm: byNumber((row) => row.rentPerSqm),
		vacancy: byNumber((row) => row.vacantDays)
	});
</script>

<PageHeader
	title="Objekte im Vergleich"
	lead="Einnahmen, Ausgaben, Kaltmiete und Leerstand je Objekt und Einheit."
/>

<Sections />

<Filters
	years={data.years}
	period={data.period}
	propertyId={data.propertyId}
	propertyOptions={data.propertyOptions}
/>

{#if data.units.length === 0 && data.properties.length <= 1}
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
							<SortHeader sort={propertySort} key="name">Objekt</SortHeader>
							<SortHeader sort={propertySort} key="units" class="num">Einheiten</SortHeader>
							<SortHeader sort={propertySort} key="received" class="num">Einnahmen</SortHeader>
							<SortHeader sort={propertySort} key="expenses" class="num">Ausgaben</SortHeader>
							<SortHeader sort={propertySort} key="net" class="num">Überschuss</SortHeader>
							<SortHeader sort={propertySort} key="rentPerSqm" class="num"
								>Kaltmiete pro m²</SortHeader
							>
							<SortHeader sort={propertySort} key="vacancy" class="num">Leerstand</SortHeader>
						</tr>
					</thead>
					<tbody>
						{#each propertySort.rows(data.properties) as row (row.id)}
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

	{#if data.units.length > 0}
		<section aria-labelledby="units">
			<h2 id="units">Einheiten</h2>
			<p class="muted small">
				Einnahmen zählen für die Haupteinheit des Mietvertrags. Ausgaben nur, wenn sie der Einheit
				selbst zugeordnet sind; Ausgaben für das ganze Objekt stehen oben beim Objekt.
			</p>
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<SortHeader sort={unitSort} key="name">Einheit</SortHeader>
							<SortHeader sort={unitSort} key="area" class="num">Fläche</SortHeader>
							<SortHeader sort={unitSort} key="baseRent" class="num">Kaltmiete (Soll)</SortHeader>
							<SortHeader sort={unitSort} key="received" class="num">Eingang</SortHeader>
							<SortHeader sort={unitSort} key="expenses" class="num">Ausgaben</SortHeader>
							<SortHeader sort={unitSort} key="net" class="num">Überschuss</SortHeader>
							<SortHeader sort={unitSort} key="rentPerSqm" class="num">pro m²</SortHeader>
							<SortHeader sort={unitSort} key="vacancy" class="num">Leerstand</SortHeader>
						</tr>
					</thead>
					<tbody>
						{#each unitSort.rows(units) as row (row.id)}
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
								<td class="number" class:negative={row.net < 0}><Money cents={row.net} signed /></td
								>
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
</style>
