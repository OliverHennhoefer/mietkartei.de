<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	// The invitation may have been used or revoked between loading the page and sending the form.
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);
	const status = $derived(refused === 'expired' || refused === 'accepted' ? refused : data.status);
</script>

<svelte:head>
	<title>Einladung | mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Einladung</h1>

	{#if status === 'expired'}
		<p>Diese Einladung ist abgelaufen. Bitte lass dich noch einmal einladen.</p>
	{:else if status === 'accepted'}
		<p>Diese Einladung wurde schon angenommen. <a href={resolve('/anmelden')}>Anmelden</a></p>
	{:else if refused === 'email-taken'}
		<p>
			Für diese E-Mail-Adresse gibt es schon ein Konto.
			<a href={resolve('/anmelden')}>Anmelden</a>
		</p>
	{:else}
		<p class="muted">
			Du wurdest als Mitverwalter eingeladen. Lege dein Zugangskonto an, um mitzuarbeiten.
		</p>
		<form method="POST" class="card" use:enhance>
			<label>
				E-Mail-Adresse
				<input type="email" value={data.email} readonly autocomplete="username" />
			</label>
			<label>
				Name
				<input
					name="name"
					defaultValue={values?.name ?? ''}
					autocomplete="name"
					aria-invalid={errors?.name ? 'true' : undefined}
					required
				/>
				{#if errors?.name}<span class="error">{errors.name}</span>{/if}
			</label>
			<label>
				Passwort
				<input
					name="password"
					type="password"
					autocomplete="new-password"
					minlength={MIN_PASSWORD_LENGTH}
					aria-invalid={errors?.password ? 'true' : undefined}
					required
				/>
				<span class="muted">Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</span>
				{#if errors?.password}<span class="error">{errors.password}</span>{/if}
			</label>
			<label>
				Passwort wiederholen
				<input
					name="passwordConfirm"
					type="password"
					autocomplete="new-password"
					aria-invalid={errors?.passwordConfirm ? 'true' : undefined}
					required
				/>
				{#if errors?.passwordConfirm}<span class="error">{errors.passwordConfirm}</span>{/if}
			</label>
			<div class="form-actions">
				<button type="submit">Konto anlegen</button>
			</div>
		</form>
	{/if}
</div>
