<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<PageHeader title="Konto" back={{ href: '/einstellungen', label: 'Einstellungen' }} />

<!-- <h2>Demodaten</h2>: the integration step adds the demo data button for an empty account here. -->

<h2>Konto löschen</h2>
{#if data.isOwner}
	<Alert tone="danger">
		<p>
			Das löscht dein Konto mit allen Objekten, Mietern, Mietverträgen, Zahlungen, Abrechnungen und
			Dokumenten endgültig, auch die Zugänge aller Mitverwalter. Lade vorher den
			<a href="/einstellungen/export">Export</a> herunter.
		</p>
	</Alert>
	<form method="POST" action="?/delete" class="card" use:enhance>
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
