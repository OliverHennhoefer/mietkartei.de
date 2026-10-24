<script lang="ts">
	import { enhance } from '$app/forms';
	import DeleteSection from '#lib/components/DeleteSection.svelte';
	import PortfolioPropertyFields from '#lib/components/PortfolioPropertyFields.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const deleteError = $derived(form && 'deleteError' in form ? form.deleteError : undefined);
</script>

<!-- The heading, address and tab bar come from +layout.svelte. -->
<h2>Objekt bearbeiten</h2>
<form method="POST" action="?/update" class="card" use:enhance>
	<PortfolioPropertyFields {values} {errors} property={data.property} />
	<div class="form-actions">
		<button type="submit">Speichern</button>
		<a href="/objekte/{data.property.id}">Abbrechen</a>
	</div>
</form>

<DeleteSection
	heading="Objekt löschen"
	label="Objekt löschen"
	question="Objekt „{data.property.name}“ löschen?"
	check={data.deletion}
	error={deleteError}
/>
