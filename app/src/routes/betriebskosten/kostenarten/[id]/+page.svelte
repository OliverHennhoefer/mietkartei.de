<script lang="ts">
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import CostCategoryForm from '#lib/components/CostCategoryForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="toolbar">
	<a href="/betriebskosten/kostenarten">← Alle Kostenarten</a>
</div>

<h2>{data.category.name}</h2>
{#if data.category.betrkvItem}
	<p class="muted">Nr. {data.category.betrkvItem} in § 2 BetrKV</p>
{/if}

<CostCategoryForm
	action="?/update"
	submitLabel="Speichern"
	keys={data.keys}
	circles={data.circles}
	category={data.category}
	errors={form?.errors}
	values={form?.values}
/>

<h2>Kostenart löschen</h2>
<ConfirmButton
	action="?/delete"
	label="Kostenart löschen"
	message="Kostenart „{data.category.name}“ wirklich löschen?"
/>
