<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader title="Objekte" lead="Gebäude und Grundstücke, die du vermietest." />

<div class="toolbar">
	<a class="button" href="/objekte/neu">Objekt anlegen</a>
</div>

{#if data.properties.length === 0}
	<EmptyState
		title="Du hast noch keine Objekte angelegt."
		text="Lege zuerst ein Objekt an und dann seine Einheiten; Mietverträge kommen danach."
	>
		<p class="row">
			<a class="button" href="/objekte/neu">Erstes Objekt anlegen</a>
			<a href="/import">Daten aus einer anderen Software importieren</a>
		</p>
	</EmptyState>
{:else}
	<ul class="list" aria-label="Objekte">
		{#each data.properties as property (property.id)}
			<li class="card">
				<div>
					<a href="/objekte/{property.id}"><strong>{property.name}</strong></a>
					<div class="muted">{property.street}, {property.postalCode} {property.city}</div>
				</div>
				<div class="muted small counts">
					{pluralize(property.unitCount, 'Einheit', 'Einheiten')}
					· {pluralize(property.activeLeases, 'laufender Mietvertrag', 'laufende Mietverträge')}
					· {property.vacantUnits === 0
						? 'kein Leerstand'
						: `Leerstand: ${pluralize(property.vacantUnits, 'Einheit', 'Einheiten')}`}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.counts {
		align-self: center;
		text-align: right;
	}
</style>
