<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const link = $derived(form && 'link' in form ? form.link : undefined);
</script>

<PageHeader title="Kalender" />

<Alert tone="info">
	<p>
		Der Kalender enthält die Fristen der nächsten zwei Jahre, überfällige eingeschlossen, und deine
		offenen Aufgaben mit Fälligkeit, jeweils mit einer Erinnerung eine Woche vorher. Die
		Kalender-App lädt ihn regelmäßig neu; Änderungen erscheinen dort mit etwas Verzögerung.
	</p>
	<p>
		Wer den Link kennt, sieht die Einträge samt Mieternamen, ohne sich anzumelden. Gib ihn nicht
		weiter; bei Bedarf erstellst du einen neuen, der alte gilt dann nicht mehr.
	</p>
</Alert>

{#if link}
	<h2>Dein Kalender-Link</h2>
	<p>
		Abonniere diesen Link in deiner Kalender-App („Kalender abonnieren“ oder „Aus URL hinzufügen“).
		Er wird nur jetzt angezeigt.
	</p>
	<input
		class="link"
		readonly
		value={link}
		aria-label="Kalender-Link"
		onfocus={(event) => event.currentTarget.select()}
	/>
{:else if data.feed}
	<p>Ein Kalender-Link besteht seit dem {formatDate(dayOf(data.feed.createdAt))}.</p>
{:else}
	<p>Es gibt noch keinen Kalender-Link.</p>
{/if}
{#if form && 'deleted' in form}
	<Alert tone="success"><p>Der Kalender-Link wurde widerrufen.</p></Alert>
{/if}
{#if form && 'message' in form}
	<p class="error" role="alert">{form.message}</p>
{/if}

<div class="form-actions">
	<form method="POST" action="?/create" use:enhance>
		<button type="submit">{data.feed ? 'Neuen Link erstellen' : 'Link erstellen'}</button>
	</form>
	{#if data.feed}
		<ConfirmButton
			action="?/delete"
			label="Link widerrufen"
			message="Kalender-Link wirklich widerrufen? Abonnierte Kalender erhalten dann keine Fristen mehr."
		/>
	{/if}
</div>

<style>
	.link {
		width: 100%;
		font-family: var(--font-mono, monospace);
	}
</style>
