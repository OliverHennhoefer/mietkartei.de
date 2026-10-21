<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let search = $state('');
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

{#if data.properties.length === 0}
	<EmptyState
		title="Du hast noch keine Objekte angelegt."
		text="Lege zuerst ein Objekt an und dann seine Einheiten; Mietverträge kommen danach."
	>
		<a class="button" href="/objekte/neu">Erstes Objekt anlegen</a>
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

	{#if filteredProperties.length === 0}
		<EmptyState
			title="Keine passenden Objekte"
			text="Versuche es mit einem anderen Namen oder einer anderen Adresse."
		>
			<button type="button" class="secondary" onclick={() => (search = '')}
				>Suche zurücksetzen</button
			>
		</EmptyState>
	{:else}
		<ul class="property-list" aria-label="Objekte">
			{#each filteredProperties as property (property.id)}
				<li>
					<a class="property-link" href="/objekte/{property.id}">
						<span class="property-icon"><Icon name="building" size={23} /></span>
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
	{/if}
{/if}

<style>
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
	}
</style>
