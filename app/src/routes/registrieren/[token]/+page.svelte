<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Registrierung bestätigen · mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Registrierung bestätigen</h1>

	{#if form?.taken}
		<p>
			Für {data.email} gibt es schon ein Konto.
			<a href={resolve('/anmelden')}>Melde dich an</a> oder setze das Passwort zurück.
		</p>
	{:else if form?.closed}
		<p>Diese E-Mail-Adresse ist nicht mehr für eine Registrierung freigeschaltet.</p>
	{:else}
		<p class="muted">
			Bestätige, dass du mit {data.email} ein Konto bei mietkartei anlegen willst. Danach bist du angemeldet.
		</p>
		<form method="POST" class="card" use:enhance>
			{#if form?.retry}
				<p class="error" role="alert">
					Gerade hat sich jemand anderes registriert. Bitte versuche es noch einmal.
				</p>
			{/if}
			<div class="form-actions">
				<button type="submit">Konto anlegen</button>
			</div>
		</form>
	{/if}
</div>
