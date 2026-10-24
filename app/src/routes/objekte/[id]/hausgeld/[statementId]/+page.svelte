<script lang="ts">
	import AssociationStatementForm from '#lib/components/AssociationStatementForm.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import { formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const title = $derived(
		`Hausgeldabrechnung ${formatDate(data.statement.periodStart)} – ${formatDate(data.statement.periodEnd)}`
	);
</script>

<div class="toolbar">
	<a href="/objekte/{data.property.id}/hausgeld">← Alle Hausgeldabrechnungen</a>
</div>

<h2>{title}</h2>
<AssociationStatementForm
	action="?/update"
	submitLabel="Speichern"
	statement={data.statement}
	errors={form?.errors}
	values={form?.values}
/>

<h2>Hausgeldabrechnung löschen</h2>
<p class="muted">Belege und Ausgaben bleiben erhalten.</p>
<ConfirmButton
	action="?/delete"
	label="Hausgeldabrechnung löschen"
	message="{title} wirklich löschen?"
/>
