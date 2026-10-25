<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<PageHeader title="Darstellung" lead="Wie mietkartei für dich aussieht." />

<form
	method="POST"
	use:enhance={() =>
		({ update }) =>
			update({ reset: false })}
>
	<label class="inline">
		<input type="checkbox" name="showPropertyMaps" checked={data.showPropertyMaps} />
		Karte bei den Objekten zeigen
	</label>
	<p class="muted hint">
		Jedes Objekt erscheint in der Liste als Punkt auf einer kleinen Deutschlandkarte, platziert nach
		seiner Postleitzahl. Die Karte ist Teil von mietkartei und lädt nichts von anderen Diensten.
	</p>
	{#if form?.saved}
		<Alert tone="success"><p>Gespeichert.</p></Alert>
	{/if}
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<style>
	.hint {
		margin: 0.4rem 0 1.25rem;
		font-size: 0.85rem;
	}
</style>
