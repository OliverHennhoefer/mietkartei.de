<script lang="ts">
	import DocumentTable from '#lib/components/DocumentTable.svelte';
	import DocumentUploadForm from '#lib/components/DocumentUploadForm.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { linkKindLabels, type LinkKind, type LinkOption } from '#lib/domain/documents.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const uploaded = $derived(form && 'uploaded' in form ? form.uploaded : undefined);

	// One select per link kind; the lists double as the upload form's options.
	const filters: { kind: LinkKind; options: LinkOption[] }[] = $derived([
		{ kind: 'propertyId', options: data.options.properties },
		{ kind: 'unitId', options: data.options.units },
		{ kind: 'leaseId', options: data.options.leases },
		{ kind: 'tenantId', options: data.options.tenants },
		{ kind: 'costItemId', options: data.options.costItems }
	]);
</script>

<PageHeader
	title="Dokumente"
	lead="Mietverträge, Belege, Protokolle und Schreiben, verknüpft mit Objekt, Mietvertrag oder Mieter."
/>

<form method="GET" class="card filter" aria-label="Filter">
	{#each filters as filter (filter.kind)}
		<label>
			{linkKindLabels[filter.kind]}
			<select name={filter.kind}>
				<option value="">Alle</option>
				{#each filter.options as option (option.id)}
					<option value={option.id} selected={data.filter[filter.kind] === option.id}>
						{option.label}
					</option>
				{/each}
			</select>
		</label>
	{/each}
	<div class="form-actions">
		<button type="submit" class="secondary">Filtern</button>
		{#if data.filtered}<a href="/dokumente">Alle anzeigen</a>{/if}
	</div>
</form>

{#if data.documents.length === 0}
	{#if data.filtered}
		<EmptyState title="Keine Dokumente für diese Auswahl.">
			<a href="/dokumente">Alle Dokumente anzeigen</a>
		</EmptyState>
	{:else}
		<EmptyState
			title="Noch keine Dokumente"
			text="Lade unten die erste Datei hoch, zum Beispiel den unterschriebenen Mietvertrag."
		/>
	{/if}
{:else}
	<DocumentTable documents={data.documents} options={data.options} deleteAction="?/delete" />
{/if}

<h2>Dokument hochladen</h2>
<DocumentUploadForm action="?/upload" {errors} {values} options={data.options} {uploaded} />

<style>
	.filter {
		margin-bottom: 1.5rem;
	}
</style>
