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
	{:else if form?.sent}
		<p role="status">
			Wir haben dir eine E-Mail mit einem Link geschickt. Öffne ihn innerhalb eines Tages, um dein
			Konto anzulegen. Hast du schon ein Konto, kommt keine E-Mail: Melde dich dann an oder setze
			dein Passwort zurück.
		</p>
	{:else}
		{#if data.restricted}
			<p>
				mietkartei ist noch nicht öffentlich. Ein Konto anlegen können nur freigeschaltete
				E-Mail-Adressen. Du bekommst einen Link, mit dem du die Adresse bestätigst.
			</p>
		{/if}
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
			{#if form?.notListed}
				<p class="error" role="alert">
					Diese E-Mail-Adresse ist nicht für eine Registrierung freigeschaltet.
				</p>
			{/if}
			{#if form?.unavailable}
				<p class="error" role="alert">{form.unavailable}</p>
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
