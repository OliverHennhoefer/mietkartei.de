<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Registrieren · mietkartei</title>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<div class="narrow">
	<h1>Registrieren</h1>

	{#if !data.open || form?.closed}
		<p>Auf dieser Instanz können sich keine weiteren Personen registrieren.</p>
	{:else}
		<form
			method="POST"
			class="card"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					// A token is valid for one check only, so a refused attempt needs a new one.
					window.turnstile?.reset();
				}}
		>
			<label>
				E-Mail-Adresse
				<input
					name="email"
					type="email"
					defaultValue={form?.values?.email ?? ''}
					autocomplete="username"
					aria-invalid={form?.errors?.email ? 'true' : undefined}
					required
				/>
				{#if form?.errors?.email}<span class="error">{form.errors.email}</span>{/if}
			</label>
			<label>
				Passwort
				<input
					name="password"
					type="password"
					autocomplete="new-password"
					minlength={MIN_PASSWORD_LENGTH}
					aria-invalid={form?.errors?.password ? 'true' : undefined}
					required
				/>
				<span class="muted">Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</span>
				{#if form?.errors?.password}<span class="error">{form.errors.password}</span>{/if}
			</label>
			{#if data.turnstileSiteKey}
				<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-language="de"></div>
			{/if}
			{#if form?.botCheckFailed}
				<p class="error" role="alert">
					Die Prüfung, ob hier ein Mensch registriert, hat nicht geklappt. Bitte versuche es noch
					einmal.
				</p>
			{/if}
			<div class="form-actions">
				<button type="submit">Konto anlegen</button>
			</div>
		</form>
	{/if}

	<p class="muted">Schon registriert? <a href={resolve('/anmelden')}>Anmelden</a></p>
</div>
