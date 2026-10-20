<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Alert from '#lib/components/Alert.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
</script>

<svelte:head>
	<title>Passwort vergessen · mietkartei</title>
</svelte:head>

<div class="narrow">
	<h1>Passwort vergessen</h1>

	{#if form && 'sent' in form && form.sent}
		<Alert tone="success">
			<p>
				Wenn es ein Konto mit dieser E-Mail-Adresse gibt, haben wir dir eine E-Mail mit einem Link
				geschickt. Der Link gilt eine Stunde.
			</p>
		</Alert>
	{:else}
		<p class="muted">
			Gib deine E-Mail-Adresse an. Wir schicken dir einen Link, mit dem du ein neues Passwort setzen
			kannst.
		</p>
		<form method="POST" class="card" use:enhance>
			<label>
				E-Mail-Adresse
				<input
					name="email"
					type="email"
					defaultValue={values?.email ?? ''}
					autocomplete="username"
					aria-invalid={errors?.email ? 'true' : undefined}
					required
				/>
				{#if errors?.email}<span class="error">{errors.email}</span>{/if}
			</label>
			<div class="form-actions">
				<button type="submit">Link anfordern</button>
			</div>
		</form>
	{/if}

	<p class="muted"><a href={resolve('/anmelden')}>Zurück zur Anmeldung</a></p>
</div>
