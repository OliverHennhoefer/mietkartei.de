<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PropertyMapDialog from '#lib/components/PropertyMapDialog.svelte';
	import PropertyMapTile from '#lib/components/PropertyMapTile.svelte';
	import { germanyOutline } from '#lib/map/germany-outline.ts';
	import { formatDate } from '#lib/dates.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let search = $state('');
	/** The property whose map tile opened the large map; undefined while it is closed. */
	let mapFor = $state<string>();
	const totals = $derived({
		units: data.properties.reduce((sum, property) => sum + property.unitCount, 0),
		leases: data.properties.reduce((sum, property) => sum + property.activeLeases, 0),
		vacant: data.properties.reduce((sum, property) => sum + property.vacantUnits, 0)
	});
	const filteredProperties = $derived(
		data.properties.filter((property) =>
			[property.name, property.street, property.postalCode, property.city]
				.join(' ')
				.toLocaleLowerCase('de')
				.includes(search.trim().toLocaleLowerCase('de'))
		)
	);
</script>

<PageHeader title="Objekte" lead="Gebäude, Einheiten und Vermietung im Überblick.">
	{#snippet actions()}
		<a class="button" href="/objekte/neu"><Icon name="plus" size={16} />Objekt anlegen</a>
	{/snippet}
</PageHeader>

{#if data.properties.length === 0 && data.archived.length === 0}
	<EmptyState
		title="Du hast noch keine Objekte angelegt."
		text="Lege zuerst ein Objekt an und dann seine Einheiten; Mietverträge kommen danach."
	>
		<a class="button" href="/objekte/neu">Erstes Objekt anlegen</a>
		<a class="button secondary" href="/einstellungen/datenuebernahme"
			>Daten aus einer anderen Software importieren</a
		>
	</EmptyState>
{:else}
	<div class="stats" aria-label="Bestandsübersicht">
		<div class="stat card">
			<span class="value">{data.properties.length}</span><span class="label">Objekte</span>
		</div>
		<div class="stat card">
			<span class="value">{totals.units}</span><span class="label">Einheiten gesamt</span>
		</div>
		<div class="stat card">
			<span class="value">{totals.leases}</span><span class="label">Laufende Mietverträge</span>
		</div>
		<div class="stat card">
			<span class="value">{totals.vacant}</span><span class="label">Einheiten im Leerstand</span>
		</div>
	</div>

	<div class="portfolio-toolbar">
		<h2>
			Deine Objekte <span class="result-count" aria-live="polite">{filteredProperties.length}</span>
		</h2>
		<label class="property-search"
			><span class="sr-only">Objekte durchsuchen</span><Icon name="search" size={16} /><input
				type="search"
				bind:value={search}
				placeholder="Name oder Adresse suchen"
			/></label
		>
	</div>

	{#if data.properties.length === 0}
		<p class="muted">Alle deine Objekte sind archiviert.</p>
	{:else if filteredProperties.length === 0}
		<EmptyState
			title="Keine passenden Objekte"
			text="Versuche es mit einem anderen Namen oder einer anderen Adresse."
		>
			<button type="button" class="secondary" onclick={() => (search = '')}
				>Suche zurücksetzen</button
			>
		</EmptyState>
	{:else}
		{#if data.showMaps}
			<svg class="map-symbols" aria-hidden="true"
				><symbol id="germany-outline"><path d={germanyOutline} /></symbol></svg
			>
		{/if}
		<ul class="property-list" aria-label="Objekte">
			{#each filteredProperties as property (property.id)}
				<li class:with-map={data.showMaps}>
					{#if data.showMaps}
						<PropertyMapTile
							position={property.position}
							image={property.mapImage}
							label="{property.name} auf der Karte zeigen"
							onclick={() => (mapFor = property.id)}
						/>
					{/if}
					<a class="property-link" href="/objekte/{property.id}">
						{#if !data.showMaps}
							<span class="property-icon"><Icon name="building" size={23} /></span>
						{/if}
						<span class="property-info">
							<strong>{property.name}</strong>
							<span class="property-address"
								>{property.street}, {property.postalCode} {property.city}</span
							>
							<span class="counts">
								{pluralize(property.unitCount, 'Einheit', 'Einheiten')}
								· {pluralize(
									property.activeLeases,
									'laufender Mietvertrag',
									'laufende Mietverträge'
								)}
								· {property.vacantUnits === 0
									? 'kein Leerstand'
									: `Leerstand: ${pluralize(property.vacantUnits, 'Einheit', 'Einheiten')}`}
							</span>
						</span>
						<span class="property-arrow"><Icon name="arrow-right" size={18} /></span>
					</a>
				</li>
			{/each}
		</ul>
		{#if filteredProperties.some((property) => property.mapImage)}
			<p class="map-credit muted">Straßenkarten: © OpenStreetMap-Mitwirkende</p>
		{/if}
		{#if mapFor}
			<PropertyMapDialog
				properties={data.properties}
				selected={mapFor}
				onclose={() => (mapFor = undefined)}
			/>
		{/if}
	{/if}
	{#if data.archived.length > 0}
		<details class="archive">
			<summary>Archiviert ({data.archived.length})</summary>
			<ul class="archive-list" aria-label="Archivierte Objekte">
				{#each data.archived as property (property.id)}
					<li>
						<a href="/objekte/{property.id}">{property.name}</a>
						<span class="muted"
							>{property.street}, {property.postalCode}
							{property.city} · archiviert am {formatDate(property.archivedAt!)}</span
						>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
{/if}

<style>
	.map-credit {
		margin: 0.5rem 0 0;
		font-size: 0.72rem;
		text-align: right;
	}
	.stats {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.portfolio-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin: 2.75rem 0 1.25rem;
	}
	.portfolio-toolbar h2 {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		font-size: 1rem;
		letter-spacing: -0.02em;
	}
	.result-count {
		display: inline-grid;
		place-items: center;
		min-width: 1.5rem;
		padding: 0 0.35rem;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		color: var(--color-muted);
		font-size: 0.72rem;
		font-weight: 400;
	}
	.property-search {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 19rem;
		padding: 0 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-muted);
		font-weight: 400;
	}
	.property-search:focus-within {
		border-color: var(--color-text);
		box-shadow: 0 0 0 3px var(--color-hover);
	}
	.property-search input {
		min-height: 2.65rem;
		padding: 0.5rem 0;
		border: 0;
		background: transparent;
		font-size: 0.8rem;
		box-shadow: none;
	}
	.property-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		overflow: hidden;
	}
	.property-list li + li {
		border-top: 1px solid var(--color-border);
	}
	/* With maps, the tile fills the first quarter of the row from edge to edge; the row as a whole
	   reacts to the pointer. */
	.property-list li.with-map {
		display: grid;
		grid-template-columns: minmax(7rem, 25%) minmax(0, 1fr);
		transition: background 140ms;
	}
	.property-list li.with-map:hover {
		background: var(--color-subtle);
	}
	.with-map .property-link {
		min-width: 0;
	}
	.with-map .property-link:hover {
		background: none;
	}
	.map-symbols {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}
	.property-link {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 1.65rem 1.5rem;
		text-decoration: none;
		transition: background 140ms;
	}
	.property-link:hover {
		background: var(--color-subtle);
	}
	.property-link:focus-visible {
		outline-offset: -3px;
	}
	.property-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 3.5rem;
		height: 3.5rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		color: var(--color-muted);
		background: var(--color-subtle);
	}
	.property-info {
		display: grid;
		flex: 1;
		gap: 0.2rem;
		min-width: 0;
	}
	.property-info strong {
		font-size: 0.95rem;
		overflow-wrap: anywhere;
	}
	.property-address {
		color: var(--color-muted);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.counts {
		margin-top: 0.4rem;
		color: var(--color-muted);
		font-size: 0.78rem;
	}
	.property-arrow {
		color: var(--color-muted);
	}
	.archive {
		margin-top: 2rem;
	}
	.archive summary {
		cursor: pointer;
		font-weight: 600;
	}
	.archive-list {
		display: grid;
		gap: 0.5rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}
	.archive-list li {
		display: grid;
		gap: 0.1rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
	@media (max-width: 75rem) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 40rem) {
		.property-search {
			width: 100%;
		}
		.property-search input {
			font-size: 16px;
		}
		.property-link {
			padding: 1.25rem;
			gap: 0.85rem;
			align-items: flex-start;
		}
		.property-icon {
			width: 2.75rem;
			height: 2.75rem;
		}
		.property-arrow {
			display: none;
		}
		.property-list li.with-map {
			grid-template-columns: 6.5rem minmax(0, 1fr);
		}
	}
</style>
