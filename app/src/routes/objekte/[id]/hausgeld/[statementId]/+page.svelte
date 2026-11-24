<script lang="ts">
	import { enhance } from '$app/forms';
	import AssociationStatementFields from '#lib/components/AssociationStatementFields.svelte';
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
<form method="POST" action="?/update" class="card" use:enhance>
	<AssociationStatementFields
		statement={data.statement}
		errors={form?.errors}
		values={form?.values}
	/>
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<h2>Hausgeldabrechnung löschen</h2>
<p class="muted">Belege und Ausgaben bleiben erhalten.</p>
<ConfirmButton
	action="?/delete"
	label="Hausgeldabrechnung löschen"
	message="{title} wirklich löschen?"
/>
