<script lang="ts">
	import AllocationKeyForm from '#lib/components/AllocationKeyForm.svelte';
	import { allocationKeyKindLabels, meterKindLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<h2 class="visually-hidden">Umlageschlüssel</h2>
<p class="muted">
	Wie eine Kostenart auf die Einheiten verteilt wird: nach Wohnfläche, Personen, Einheiten,
	Verbrauch oder eigenen Anteilen. Die vorbelegten Schlüssel gelten für alle Objekte.
</p>

<div class="table-wrap">
	<table class="table" aria-label="Umlageschlüssel">
		<thead>
			<tr>
				<th>Umlageschlüssel</th>
				<th>Art</th>
				<th>Objekt</th>
				<th>Zählerart</th>
				<th class="num">Verbrauchsanteil</th>
				<th class="num">Belege</th>
			</tr>
		</thead>
		<tbody>
			{#each data.keys as key (key.id)}
				<tr>
					<td><a href="/betriebskosten/schluessel/{key.id}">{key.name}</a></td>
					<td>{allocationKeyKindLabels[key.kind]}</td>
					<td>{key.propertyName ?? 'alle Objekte'}</td>
					<td>{key.meterKind ? meterKindLabels[key.meterKind] : '–'}</td>
					<td class="num">
						{key.consumptionPercent !== null ? `${key.consumptionPercent} %` : '–'}
					</td>
					<td class="num">{key.costItemCount}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Umlageschlüssel anlegen</h2>
<AllocationKeyForm
	action="?/create"
	submitLabel="Umlageschlüssel anlegen"
	properties={data.properties}
	errors={form?.errors}
	values={form?.values}
/>
