<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import InsurancePolicyFields from '#lib/components/InsurancePolicyFields.svelte';
	import { insuranceKindLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="toolbar">
	<a href="/objekte/{data.property.id}/versicherungen">← Alle Versicherungen</a>
</div>

<h2>{insuranceKindLabels[data.policy.kind]} ({data.policy.insurer})</h2>
<form method="POST" action="?/update" class="card" use:enhance>
	<InsurancePolicyFields policy={data.policy} errors={form?.errors} values={form?.values} />
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<h2>Versicherung löschen</h2>
<p class="muted">Belege, die aus dieser Versicherung übernommen wurden, bleiben erhalten.</p>
<ConfirmButton
	action="?/delete"
	label="Versicherung löschen"
	message="Versicherung „{insuranceKindLabels[data.policy.kind]}“ wirklich löschen?"
/>
