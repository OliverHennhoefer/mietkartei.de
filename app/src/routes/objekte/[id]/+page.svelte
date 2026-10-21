<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import PortfolioUnitFields from '#lib/components/PortfolioUnitFields.svelte';
	import { formatArea, formatNumber, personName } from '#lib/format.ts';
	import { unitKindLabels } from '#lib/units.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
</script>

<!-- The heading and address come from +layout.svelte. -->
<div class="toolbar">
	<a class="button secondary" href="/objekte/{data.property.id}/bearbeiten">Bearbeiten</a>
</div>

<h2>Einheiten</h2>
{#if data.units.length === 0}
	<p>Dieses Objekt hat noch keine Einheiten.</p>
{:else}
	<ul class="list" aria-label="Einheiten">
		{#each data.units as unit (unit.id)}
			<li class="card">
				<div>
					<a href="/objekte/{data.property.id}/einheiten/{unit.id}"><strong>{unit.name}</strong></a>
					<span class="muted">
						· {unitKindLabels[unit.kind]}{#if unit.floorArea !== null}
							· {formatArea(unit.floorArea)}{/if}{#if unit.floor}
							· {unit.floor}{/if}{#if unit.rooms !== null}
							· {formatNumber(unit.rooms)} Zimmer{/if}
					</span>
				</div>
				<div class="occupancy">
					{#if unit.occupancies.length === 0}
						<Badge tone="warning">Leerstand</Badge>
						<a href="/vertraege/neu?unitId={unit.id}">Mietvertrag anlegen</a>
					{:else}
						{#each unit.occupancies as occupancy (occupancy.leaseId)}
							<a href="/vertraege/{occupancy.leaseId}">
								{occupancy.tenants.length > 0
									? occupancy.tenants.map(personName).join(', ')
									: 'Mietvertrag ohne Mieter'}
							</a>
							{#if !occupancy.main}<span class="muted small">(mitvermietet)</span>{/if}
						{/each}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<h2>Einheit anlegen</h2>
<form method="POST" action="?/createUnit" class="card" use:enhance>
	<PortfolioUnitFields {values} {errors} />
	<div class="form-actions">
		<button type="submit">Einheit anlegen</button>
	</div>
	{#if form && 'created' in form}
		<p class="form-actions" role="status">„{form.created}“ wurde angelegt.</p>
	{/if}
</form>

<style>
	.occupancy {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
	}
</style>
