<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordField from '#lib/components/PasswordField.svelte';
	import { MIN_PASSWORD_LENGTH } from '#lib/validation.ts';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Neues Passwort | mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Neues Passwort</h1>
	<p class="muted">
		Wähle ein neues Passwort. Danach bist du auf allen anderen Geräten abgemeldet.
	</p>

	<form method="POST" class="card" use:enhance>
		<PasswordField
			label="Neues Passwort"
			note={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`}
			error={form?.errors?.password}
			name="password"
			autocomplete="new-password"
			minlength={MIN_PASSWORD_LENGTH}
			aria-invalid={form?.errors?.password ? 'true' : undefined}
			required
		/>
		<PasswordField
			label="Neues Passwort wiederholen"
			error={form?.errors?.passwordConfirm}
			name="passwordConfirm"
			autocomplete="new-password"
			aria-invalid={form?.errors?.passwordConfirm ? 'true' : undefined}
			required
		/>
		<div class="form-actions">
			<button type="submit">Passwort setzen</button>
		</div>
	</form>
</div>
