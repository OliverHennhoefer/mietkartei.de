<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import CostItemForm from '#lib/components/CostItemForm.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The prefill query stays in the URL when the form comes back with errors.
	const action = $derived(`${page.url.search ? `${page.url.search}&` : '?'}/create`);

	// "Speichern und nächsten Beleg" redirects back here, which keeps the page and the typed
	// values; a new form for every navigation starts the next item empty.
	let visit = $state(0);
	afterNavigate(({ type }) => {
		if (type !== 'enter') visit += 1;
	});
</script>

<div class="toolbar">
	<a href="/betriebskosten/belege">← Alle Belege</a>
</div>

<h2>Beleg erfassen</h2>

{#if data.properties.length === 0}
	<EmptyState title="Noch kein Objekt" text="Belege gehören zu einem Objekt. Lege zuerst eines an.">
		<a class="button" href="/objekte">Objekt anlegen</a>
	</EmptyState>
{:else}
	<p class="muted">
		Umlageschlüssel und Abrechnungskreis kannst du auf „Standard der Kostenart“ lassen; dann gelten
		die Einstellungen der Kostenart. Mit „Speichern und nächsten Beleg“ bleiben Objekt und Zeitraum
		für den nächsten Beleg erhalten.
	</p>
	{#key visit}
		<CostItemForm
			{action}
			properties={data.properties}
			categories={data.categories}
			keys={data.keys}
			circles={data.circles}
			prefill={data.prefill}
			history={data.history}
			errors={form?.errors}
			values={form?.values}
			withNext
		/>
	{/key}
{/if}
