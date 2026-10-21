<script lang="ts">
	import { enhance } from '$app/forms';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Neues Passwort · mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Neues Passwort</h1>
	<p class="muted">
		Wähle ein neues Passwort. Danach bist du auf allen anderen Geräten abgemeldet.
	</p>

	<form method="POST" class="card" use:enhance>
		<label>
			Neues Passwort
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
			Neues Passwort wiederholen
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
		<div class="form-actions">
			<button type="submit">Passwort setzen</button>
		</div>
	</form>
</div>
