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

<h2>Fristen per E-Mail</h2>
<p>
	Jeden Montag eine Übersicht an {data.deadlineMail.email}: die Fristen und deine offenen Aufgaben,
	die überfällig sind oder in den nächsten zwei Wochen anstehen, jeweils mit Link. Steht nichts an,
	kommt keine E-Mail.
</p>
{#if data.demo}
	<p class="muted">In der Demo werden keine E-Mails verschickt.</p>
{/if}
{#if data.deadlineMail.on}
	<p>
		Die wöchentliche Übersicht ist eingeschaltet{data.deadlineMail.sentOn
			? `; zuletzt am ${formatDate(data.deadlineMail.sentOn)}`
			: ''}.
	</p>
{/if}
{#if form && 'mailSaved' in form}
	<Alert tone="success">
		<p>
			{form.mailSaved
				? 'Die wöchentliche Übersicht ist eingeschaltet. Die erste kommt mit dem nächsten Lauf, spätestens am nächsten Morgen.'
				: 'Die wöchentliche Übersicht ist ausgeschaltet.'}
		</p>
	</Alert>
{/if}
<form method="POST" action="?/mail" use:enhance class="form-actions">
	<input type="hidden" name="on" value={data.deadlineMail.on ? 'false' : 'true'} />
	<button type="submit" class={data.deadlineMail.on ? 'secondary' : undefined}>
		{data.deadlineMail.on ? 'Übersicht abbestellen' : 'Wöchentliche Übersicht einschalten'}
	</button>
</form>

<style>
	.link {
		width: 100%;
		font-family: var(--font-mono, monospace);
	}
</style>
