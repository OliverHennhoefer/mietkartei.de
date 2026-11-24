<script lang="ts">
	import { page } from '$app/state';
	import FormDialog from '#lib/components/FormDialog.svelte';
	import AllocationKeyFields from '#lib/components/AllocationKeyFields.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { allocationKeyKindLabels, meterKindLabels } from '#lib/labels.ts';
	import { byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// ?neu opens the create dialog; it stays open while the server refuses the input.
	const creating = $derived(page.url.searchParams.has('neu'));
	const sort = new TableSort<PageProps['data']['keys'][number]>({
		name: byText((key) => key.name),
		kind: byText((key) => allocationKeyKindLabels[key.kind]),
		property: byText((key) => key.propertyName ?? 'alle Objekte'),
		meter: byText((key) => (key.meterKind ? meterKindLabels[key.meterKind] : null)),
		consumption: byNumber((key) => key.consumptionPercent),
		items: byNumber((key) => key.costItemCount)
	});
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
				<SortHeader {sort} key="name">Umlageschlüssel</SortHeader>
				<SortHeader {sort} key="kind">Art</SortHeader>
				<SortHeader {sort} key="property">Objekt</SortHeader>
				<SortHeader {sort} key="meter">Zählerart</SortHeader>
				<SortHeader {sort} key="consumption" class="num">Verbrauchsanteil</SortHeader>
				<SortHeader {sort} key="items" class="num">Belege</SortHeader>
			</tr>
		</thead>
		<tbody>
			{#each sort.rows(data.keys) as key (key.id)}
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

{#if creating}
	<FormDialog
		title="Umlageschlüssel anlegen"
		action="?/create"
		submitLabel="Umlageschlüssel anlegen"
		close={page.url.pathname}
	>
		<AllocationKeyFields properties={data.properties} errors={form?.errors} values={form?.values} />
	</FormDialog>
{/if}
