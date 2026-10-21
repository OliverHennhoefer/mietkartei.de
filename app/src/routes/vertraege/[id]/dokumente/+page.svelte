<script lang="ts">
	import DocumentTable from '#lib/components/DocumentTable.svelte';
	import DocumentUploadForm from '#lib/components/DocumentUploadForm.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const uploaded = $derived(form && 'uploaded' in form ? form.uploaded : undefined);
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Dokumente" tab. -->
<h2>Dokumente</h2>
<div class="toolbar">
	<a href="/dokumente?leaseId={data.lease.id}" class="button secondary">Alle Dokumente</a>
</div>

{#if data.documents.length === 0}
	<EmptyState
		title="Noch keine Dokumente zu diesem Mietvertrag"
		text="Lade unten zum Beispiel den unterschriebenen Mietvertrag oder das Übergabeprotokoll hoch."
	/>
{:else}
	<DocumentTable
		documents={data.documents}
		options={data.options}
		deleteAction="?/delete"
		omit={['leaseId']}
	/>
{/if}

<h2>Dokument hochladen</h2>
<p class="muted">Die Datei wird mit diesem Mietvertrag und seinem Objekt verknüpft.</p>
<DocumentUploadForm action="?/upload" {errors} {values} {uploaded}>
	<input type="hidden" name="leaseId" value={data.lease.id} />
</DocumentUploadForm>
