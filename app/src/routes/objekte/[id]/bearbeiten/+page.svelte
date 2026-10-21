<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
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

<h2>Objekt löschen</h2>
{#if deleteError}
	<Alert tone="danger"><p>{deleteError}</p></Alert>
{/if}
<p class="muted">
	Löscht das Objekt mit allen Einheiten, Zählern, Umlageschlüsseln, Abrechnungskreisen, Belegen und
	Betriebskostenabrechnungen. Ein Objekt, auf dessen Einheiten Mietverträge liegen, kann nicht
	gelöscht werden.
</p>
<ConfirmButton
	action="?/delete"
	label="Objekt löschen"
	message="Objekt „{data.property
		.name}“ mit allen Einheiten, Zählern, Umlageschlüsseln, Abrechnungskreisen, Belegen und Betriebskostenabrechnungen löschen? Das lässt sich nicht rückgängig machen."
/>
