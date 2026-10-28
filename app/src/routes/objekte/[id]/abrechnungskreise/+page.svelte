<script lang="ts">
	import BillingCircleForm from '#lib/components/BillingCircleForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const unitName = (unitId: string) => data.units.find((unit) => unit.id === unitId)?.name ?? '?';
</script>

<!-- The heading and tab bar come from the layout; this page is the "Abrechnungskreise" tab. -->
<h2 class="visually-hidden">Abrechnungskreise</h2>
<p class="muted">
	Ein Abrechnungskreis ist die Gruppe von Einheiten, die sich eine Kostenart teilt: etwa die
	Stellplätze, die nichts zu den Gebäudekosten beitragen, oder ein Haus mit mehreren Eingängen, bei
	dem jedes Treppenhaus seine eigene Reinigung bezahlt. Ein Beleg ohne Abrechnungskreis wird auf
	alle Einheiten des Objekts verteilt.
</p>

{#if data.circles.length === 0}
	<p>Dieses Objekt hat noch keine Abrechnungskreise.</p>
{:else}
	<ul class="list" aria-label="Abrechnungskreise">
		{#each data.circles as circle (circle.id)}
			<li class="card">
				<a href="/objekte/{data.property.id}/abrechnungskreise/{circle.id}">
					<strong>{circle.name}</strong>
				</a>
				<span class="muted">
					{#if circle.unitIds.length === 0}keine Einheiten{:else}
						{circle.unitIds.map(unitName).join(', ')}
					{/if}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<h2 id="abrechnungskreis-anlegen">Abrechnungskreis anlegen</h2>
<BillingCircleForm
	action="?/create"
	submitLabel="Abrechnungskreis anlegen"
	units={data.units}
	errors={form?.errors}
	values={form?.values}
/>
