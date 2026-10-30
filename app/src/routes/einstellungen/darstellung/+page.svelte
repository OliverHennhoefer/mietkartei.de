<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const themeOptions = [
		{ value: 'system', label: 'Wie das Gerät' },
		{ value: 'light', label: 'Hell' },
		{ value: 'dark', label: 'Dunkel' }
	] as const;
</script>

<PageHeader title="Darstellung" />

<form
	method="POST"
	use:enhance={() =>
		({ update }) =>
			update({ reset: false })}
>
	<fieldset class="themes">
		<legend>Farben</legend>
		{#each themeOptions as option (option.value)}
			<label class="inline">
				<input
					type="radio"
					name="theme"
					value={option.value}
					checked={data.theme === option.value}
				/>
				{option.label}
			</label>
		{/each}
	</fieldset>
	<p class="muted hint">
		„Wie das Gerät“ folgt dem hellen oder dunklen Modus deines Computers oder Handys.
	</p>
	<label class="inline">
		<input type="checkbox" name="showPropertyMaps" checked={data.showPropertyMaps} />
		Karte bei den Objekten zeigen
	</label>
	<p class="muted hint">
		Jedes Objekt erscheint in der Liste mit einer kleinen Straßenkarte seiner Umgebung. Dafür fragt
		mietkartei einmal je Adresse beim Geocoder von OpenStreetMap (Nominatim) nach, wo das Objekt
		liegt; übermittelt wird nur die Adresse des Objekts. Bis dahin zeigt die Karte die Gegend der
		Postleitzahl. Die Karten selbst kommen von mietkartei, nicht von anderen Diensten.
	</p>
	{#if form?.saved}
		<Alert tone="success"><p>Gespeichert.</p></Alert>
	{/if}
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<style>
	.themes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.themes legend {
		font-weight: 500;
		font-size: var(--text-sm);
		padding: 0;
		margin-bottom: 0.5rem;
	}
	.hint {
		margin: 0.4rem 0 1.25rem;
		font-size: var(--text-sm);
	}
</style>
