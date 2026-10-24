<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import { LAUNCH } from '#lib/launch.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Anmelden | mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Anmelden</h1>
	<p class="auth-lead">Melde dich an, um deinen Bestand zu verwalten.</p>

	{#if data.prelaunch}
		<Alert role="note">
			mietkartei startet im {LAUNCH}. Bis dahin melden sich hier nur freigeschaltete Vermieter an.
		</Alert>
	{/if}

	<form method="POST" class="card" use:enhance>
		{#if form && 'locked' in form && form.locked}
			<p class="error" role="alert">Zu viele Fehlversuche. Bitte warte 15 Minuten.</p>
		{:else if form?.invalid}
			<p class="error" role="alert">E-Mail-Adresse oder Passwort stimmen nicht.</p>
		{/if}
		<label>
			E-Mail-Adresse
			<input
				name="email"
				type="email"
				defaultValue={form?.email ?? ''}
				autocomplete="username"
				required
			/>
		</label>
		<label>
			Passwort
			<input name="password" type="password" autocomplete="current-password" required />
		</label>
		<div class="form-actions">
			<button type="submit">Anmelden</button>
			<a href="/passwort-vergessen" class="small">Passwort vergessen?</a>
		</div>
	</form>
</div>
