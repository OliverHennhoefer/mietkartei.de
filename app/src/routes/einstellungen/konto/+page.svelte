<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<PageHeader title="Konto" back={{ href: '/einstellungen', label: 'Einstellungen' }} />

{#if data.canLoadDemo}
	<h2>Demodaten</h2>
	<p>
		Probier mietkartei mit einem kleinen Beispielbestand aus: zwei Objekte, fünf Mietverträge, zwei
		Jahre Mietzahlungen, ein Bankkonto mit offenen Umsätzen, Belege des Vorjahres und zwei Aufgaben.
		Das geht nur, solange dein Konto noch kein Objekt hat. Wenn du fertig bist, löschst du das Konto
		unten und fängst neu an.
	</p>
	<form method="POST" action="?/demo" use:enhance>
		{#if form?.demoError}<p class="error" role="alert">{form.demoError}</p>{/if}
		<button type="submit">Demodaten anlegen</button>
	</form>
{/if}

<h2>Konto löschen</h2>
{#if data.isOwner}
	<Alert tone="danger">
		<p>
			Das löscht dein Konto mit allen Objekten, Mietern, Mietverträgen, Zahlungen, Abrechnungen und
			Dokumenten endgültig, auch die Zugänge aller Mitverwalter. Lade vorher den
			<a href="/einstellungen/export">Export</a> herunter.
		</p>
		{#if data.subscriptionRuns}
			<p>Dein Abo wird dabei sofort gekündigt; danach bucht Stripe nichts mehr ab.</p>
		{/if}
	</Alert>
	<form method="POST" action="?/delete" class="card" use:enhance>
		{#if form?.stripeError}<p class="error" role="alert">{form.stripeError}</p>{/if}
		<label>
			Passwort
			<input
				name="password"
				type="password"
				autocomplete="current-password"
				aria-invalid={form?.errors?.password ? 'true' : undefined}
				required
			/>
			{#if form?.errors?.password}<span class="error">{form.errors.password}</span>{/if}
		</label>
		<div class="form-actions">
			<button type="submit" class="danger">Konto endgültig löschen</button>
		</div>
	</form>
{:else}
	<p>Nur der Vermieter kann das Konto löschen.</p>
{/if}
