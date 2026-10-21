<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Konto anlegen · mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Konto anlegen</h1>

	{#if form?.taken}
		<p>
			Für {data.email} gibt es schon ein Konto.
			<a href={resolve('/anmelden')}>Melde dich an</a> oder setze das Passwort zurück.
		</p>
	{:else if form?.closed}
		<p>Diese E-Mail-Adresse ist nicht mehr für eine Registrierung freigeschaltet.</p>
	{:else}
		<p class="muted">
			Wähle ein Passwort für dein Konto mit {data.email}. Danach bist du angemeldet.
		</p>
		<form method="POST" class="card" use:enhance>
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
			<label>
				Passwort wiederholen
				<input
					name="passwordConfirm"
					type="password"
					autocomplete="new-password"
					aria-invalid={form?.errors?.passwordConfirm ? 'true' : undefined}
					required
				/>
				{#if form?.errors?.passwordConfirm}<span class="error">{form.errors.passwordConfirm}</span
					>{/if}
			</label>
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
