<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import LaunchNotice from '#lib/components/LaunchNotice.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * After signing in, the consent page of an app is loaded as a whole document: its answer is a
	 * redirect to the app, which only that page's own CSP allows (see hooks.server.ts).
	 */
	const signIn: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'redirect' && result.location.startsWith('/oauth/')) {
				window.location.assign(result.location);
				return;
			}
			await update();
		};
</script>

<svelte:head>
	<title>Anmelden | mietkartei</title>
</svelte:head>

<div class="narrow">
	<a class="back-link" href="https://mietkartei.de"
		><span aria-hidden="true">←</span> Zur Startseite</a
	>
	<h1>Anmelden</h1>
	<p class="auth-lead">Melde dich an, um deinen Bestand zu verwalten.</p>

	{#if data.prelaunch}<LaunchNotice />{/if}

	<form method="POST" class="card" use:enhance={signIn}>
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
