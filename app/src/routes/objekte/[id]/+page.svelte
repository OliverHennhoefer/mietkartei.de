<script lang="ts">
	import { page } from '$app/state';
	import FormDialog from '#lib/components/FormDialog.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import PortfolioUnitFields from '#lib/components/PortfolioUnitFields.svelte';
	import { leaseTenantName } from '#lib/domain/addressee.ts';
	import { formatArea, formatNumber } from '#lib/format.ts';
	import { unitKindLabels } from '#lib/units.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// ?neu opens the create dialog; it stays open while the server refuses the input.
	const creating = $derived(page.url.searchParams.has('neu') && !(form && 'created' in form));
	// What the dialog created, named above the list once it has closed.
	let created = $state<string>();
	$effect(() => {
		if (creating) created = undefined;
	});
	const createdName = $derived(created ?? (form && 'created' in form ? form.created : undefined));

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
</script>

<!-- The heading, address and tab bar come from +layout.svelte; this page is the "Einheiten" tab. -->
<h2 class="visually-hidden">Einheiten</h2>
{#if createdName && !creating}<p role="status">„{createdName}“ wurde angelegt.</p>{/if}
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
									? leaseTenantName(occupancy.tenants)
									: 'Mietvertrag ohne Mieter'}
							</a>
							{#if !occupancy.main}<span class="muted small">(mitvermietet)</span>{/if}
						{/each}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	{#if data.units.some((unit) => unit.occupancies.length > 0)}
		<p><a href="/mieter?objekt={data.property.id}">Mieter dieses Objekts</a></p>
	{/if}
{/if}

{#if creating}
	<FormDialog
		title="Einheit anlegen"
		action="?/createUnit"
		submitLabel="Einheit anlegen"
		close={page.url.pathname}
		onsaved={(saved) => (created = String(saved?.created ?? ''))}
	>
		<PortfolioUnitFields {values} {errors} />
	</FormDialog>
{/if}

<style>
	.occupancy {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
	}
</style>
