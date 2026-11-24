<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import CostCategoryFields from '#lib/components/CostCategoryFields.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);
</script>

<div class="toolbar">
	<a href="/betriebskosten/kostenarten">← Alle Kostenarten</a>
</div>

<h2>{data.category.name}</h2>
<p class="muted">
	{#if data.category.betrkvItem}Nr. {data.category.betrkvItem} in § 2 BetrKV ·
	{/if}
	{data.category.costItemCount === 1 ? '1 Beleg' : `${data.category.costItemCount} Belege`} mit dieser
	Kostenart
</p>

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{/if}

<form method="POST" action="?/update" class="card" use:enhance>
	<CostCategoryFields
		keys={data.keys}
		circles={data.circles}
		category={data.category}
		{errors}
		{values}
	/>
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<h2>Kostenart löschen</h2>
<p class="muted">Eine Kostenart, die Belege verwenden, kann nicht gelöscht werden.</p>
<ConfirmButton
	action="?/delete"
	label="Kostenart löschen"
	message="Kostenart „{data.category.name}“ wirklich löschen?"
/>
