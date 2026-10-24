<script lang="ts">
	import { enhance } from '$app/forms';
	import ArchiveSection from '#lib/components/ArchiveSection.svelte';
	import DeleteSection from '#lib/components/DeleteSection.svelte';
	import PortfolioPropertyFields from '#lib/components/PortfolioPropertyFields.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const archiveError = $derived(form && 'archiveError' in form ? form.archiveError : undefined);
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

<ArchiveSection
	heading="Objekt archivieren"
	label="Objekt archivieren"
	question="Objekt „{data.property.name}“ archivieren? Du kannst es jederzeit aus dem Archiv holen."
	text="Für ein verkauftes Objekt: Es verschwindet aus der Objektliste und den Auswahlfeldern, neue Mietverträge sind dort nicht mehr möglich. Mietverträge, Mietkonten, Abrechnungen und Dokumente bleiben erhalten; Belege und Ausgaben lassen sich weiter zuordnen."
	check={data.archiving}
	error={archiveError}
/>

<DeleteSection
	heading="Objekt löschen"
	label="Objekt löschen"
	question="Objekt „{data.property.name}“ löschen?"
	check={data.deletion}
	alternative="Ist das Objekt verkauft, archiviere es stattdessen: Die Historie bleibt, und es verschwindet aus Listen und Auswahlfeldern."
	error={deleteError}
/>
