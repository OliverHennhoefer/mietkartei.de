<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from './Field.svelte';

	// The fields of a tenant, shared by /mieter/neu and /mieter/[id]/bearbeiten. Values are the
	// strings of the last submit (or the tenant's columns), so a failed submit keeps what was typed.
	let {
		action,
		values,
		errors,
		submitLabel,
		cancelHref,
		returnTo = null
	}: {
		action: string;
		values: Record<string, string>;
		errors: Partial<Record<string, string>>;
		submitLabel: string;
		cancelHref: string;
		/** Where to go after creating, carried as a hidden field (see /mieter/neu). */
		returnTo?: string | null;
	} = $props();
</script>

<form method="POST" {action} class="card" use:enhance>
	{#if returnTo}<input type="hidden" name="return" value={returnTo} />{/if}
	<Field label="Anrede (optional)" error={errors.salutation}>
		<input
			name="salutation"
			defaultValue={values.salutation ?? ''}
			placeholder="Frau, Herr, Firma"
			aria-invalid={errors.salutation ? 'true' : undefined}
		/>
	</Field>
	<Field label="Vorname" error={errors.firstName}>
		<input
			name="firstName"
			defaultValue={values.firstName ?? ''}
			autocomplete="off"
			aria-invalid={errors.firstName ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Nachname" error={errors.lastName}>
		<input
			name="lastName"
			defaultValue={values.lastName ?? ''}
			autocomplete="off"
			aria-invalid={errors.lastName ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="E-Mail-Adresse (optional)" error={errors.email}>
		<input
			name="email"
			type="email"
			defaultValue={values.email ?? ''}
			autocomplete="off"
			aria-invalid={errors.email ? 'true' : undefined}
		/>
	</Field>
	<Field label="Telefon (optional)" error={errors.phone}>
		<input
			name="phone"
			type="tel"
			defaultValue={values.phone ?? ''}
			autocomplete="off"
			aria-invalid={errors.phone ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Straße und Hausnummer (optional)"
		error={errors.street}
		hint="Für Schreiben; leer, wenn der Mieter in der gemieteten Einheit wohnt."
	>
		<input
			name="street"
			defaultValue={values.street ?? ''}
			autocomplete="off"
			aria-invalid={errors.street ? 'true' : undefined}
		/>
	</Field>
	<Field label="Postleitzahl (optional)" error={errors.postalCode}>
		<input
			name="postalCode"
			defaultValue={values.postalCode ?? ''}
			inputmode="numeric"
			autocomplete="off"
			aria-invalid={errors.postalCode ? 'true' : undefined}
		/>
	</Field>
	<Field label="Ort (optional)" error={errors.city}>
		<input
			name="city"
			defaultValue={values.city ?? ''}
			autocomplete="off"
			aria-invalid={errors.city ? 'true' : undefined}
		/>
	</Field>
	<div class="form-wide">
		<Field label="Notizen (optional)" error={errors.notes}>
			<textarea name="notes" aria-invalid={errors.notes ? 'true' : undefined}
				>{values.notes ?? ''}</textarea
			>
		</Field>
	</div>
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
		<a href={cancelHref} class="button secondary">Abbrechen</a>
	</div>
</form>
