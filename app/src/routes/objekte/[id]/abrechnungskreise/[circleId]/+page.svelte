<script lang="ts">
	import { enhance } from '$app/forms';
	import BillingCircleFields from '#lib/components/BillingCircleFields.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="toolbar">
	<a href="/objekte/{data.property.id}/abrechnungskreise">← Alle Abrechnungskreise</a>
</div>

<h2>{data.circle.name}</h2>
<form method="POST" action="?/update" class="card" use:enhance>
	<BillingCircleFields
		units={data.units}
		circle={data.circle}
		errors={form?.errors}
		values={form?.values}
	/>
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<h2>Abrechnungskreis löschen</h2>
<p class="muted">
	Belege und Kostenarten, die diesen Kreis verwenden, gelten danach für alle Einheiten des Objekts.
</p>
<ConfirmButton
	action="?/delete"
	label="Abrechnungskreis löschen"
	message="Abrechnungskreis „{data.circle.name}“ wirklich löschen?"
/>
