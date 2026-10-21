<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import AllocationKeyForm from '#lib/components/AllocationKeyForm.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import { formatNumber } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const keyForm = $derived(form?.form === 'key' ? form : undefined);
	const sharesForm = $derived(form?.form === 'shares' ? form : undefined);
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);

	const shareOf = (unitId: string) => data.shares.find((share) => share.unitId === unitId)?.share;
	const shareValue = (unitId: string) => {
		const typed = sharesForm && 'shareValues' in sharesForm ? sharesForm.shareValues : undefined;
		if (typed) return typed[`share-${unitId}`] ?? '';
		const share = shareOf(unitId);
		return share === undefined ? '' : formatNumber(share);
	};
	const shareError = (unitId: string) =>
		sharesForm && 'shareErrors' in sharesForm
			? (sharesForm.shareErrors as Record<string, string | undefined>)[`share-${unitId}`]
			: undefined;
	const total = $derived(data.shares.reduce((sum, share) => sum + share.share, 0));
</script>

<div class="toolbar">
	<a href="/betriebskosten/schluessel">← Alle Umlageschlüssel</a>
</div>

<h2>{data.key.name}</h2>
<p class="muted">
	{data.key.costItemCount === 1 ? '1 Beleg' : `${data.key.costItemCount} Belege`} mit diesem Schlüssel
</p>

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{/if}

<AllocationKeyForm
	action="?/update"
	submitLabel="Speichern"
	properties={data.properties}
	key={data.key}
	errors={keyForm && 'errors' in keyForm ? keyForm.errors : undefined}
	values={keyForm && 'values' in keyForm ? keyForm.values : undefined}
/>

{#if data.key.kind === 'custom' && data.key.propertyId}
	<h2>Anteile je Einheit</h2>
	<p class="muted">
		Die Anteile der Einheiten von {data.key.propertyName}, z. B. Miteigentumsanteile. Eine Einheit
		ohne Anteil bleibt frei. Summe: {formatNumber(total)}.
	</p>
	{#if sharesForm && 'saved' in sharesForm}
		<Alert tone="success"><p>Die Anteile wurden gespeichert.</p></Alert>
	{/if}
	{#if data.units.length === 0}
		<p>Das Objekt hat noch keine Einheiten.</p>
	{:else}
		<form method="POST" action="?/shares" class="card" use:enhance>
			{#each data.units as unit (unit.id)}
				<label>
					{unit.name}
					<input
						name="share-{unit.id}"
						inputmode="decimal"
						defaultValue={shareValue(unit.id)}
						aria-invalid={shareError(unit.id) ? 'true' : undefined}
					/>
					{#if shareError(unit.id)}<span class="error">{shareError(unit.id)}</span>{/if}
				</label>
			{/each}
			<div class="form-actions">
				<button type="submit">Anteile speichern</button>
			</div>
		</form>
	{/if}
{/if}

<h2>Umlageschlüssel löschen</h2>
<p class="muted">Ein Schlüssel, den Belege verwenden, kann nicht gelöscht werden.</p>
<ConfirmButton
	action="?/delete"
	label="Umlageschlüssel löschen"
	message="Umlageschlüssel „{data.key.name}“ wirklich löschen?"
/>
