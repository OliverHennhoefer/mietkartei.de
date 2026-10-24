<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<PageHeader title="Konto" />

{#if data.canLoadDemo}
	<section class="card demo" aria-labelledby="demodaten">
		<h2 id="demodaten">Demodaten</h2>
		<p>
			Probier mietkartei mit einem kleinen Beispielbestand aus: zwei Objekte, fünf Mietverträge,
			zwei Jahre Mietzahlungen, ein Bankkonto mit offenen Umsätzen, Belege des Vorjahres und zwei
			Aufgaben. Das geht nur, solange dein Konto noch kein Objekt hat. Wenn du fertig bist, löschst
			du das Konto unten und fängst neu an.
		</p>
		{#if form?.demoFailed}
			<Alert tone="danger"><p>{form.demoFailed}</p></Alert>
		{/if}
		<form method="POST" action="?/demo" use:enhance>
			<button type="submit">Demodaten anlegen</button>
		</form>
	</section>
{/if}

{#if form?.failed}
	<Alert tone="danger"><p>{form.failed}</p></Alert>
{/if}

<section class="card danger-zone" aria-labelledby="konto-loeschen">
	<h2 id="konto-loeschen">Konto löschen</h2>
	{#if data.isOwner}
		<p>
			Das löscht dein Konto mit allen Objekten, Mietern, Mietverträgen, Zahlungen, Abrechnungen und
			Dokumenten endgültig, auch alle weiteren Zugänge. Lade vorher den
			<a href="/einstellungen/export">Export</a> herunter.
		</p>
		{#if data.subscriptionRuns}
			<p>Dein Abo wird dabei sofort gekündigt; danach bucht Stripe nichts mehr ab.</p>
		{/if}
		<form method="POST" action="?/delete" class="form" use:enhance>
			<label>
				Passwort
				<input
					name="password"
					type="password"
					autocomplete="current-password"
					maxlength="200"
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
		<p class="muted">Nur der Vermieter kann das Konto löschen.</p>
	{/if}
</section>

<style>
	.demo {
		max-width: 45rem;
		margin-bottom: 1.5rem;
	}
	.demo h2 {
		margin: 0 0 0.75rem;
	}
	.demo p {
		margin: 0 0 1.25rem;
	}
	.danger-zone {
		max-width: 45rem;
		border-color: var(--color-danger-border);
		border-left: 3px solid var(--color-danger);
	}
	.danger-zone h2 {
		margin: 0 0 0.75rem;
		color: var(--color-danger);
	}
	.danger-zone p {
		margin: 0 0 1.25rem;
	}
	.danger-zone .form-actions button {
		border-color: var(--color-danger-border);
	}
	.danger-zone .form-actions button:hover {
		background: var(--color-danger-subtle);
	}
</style>
