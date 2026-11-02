<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from './Field.svelte';
	import FormSection from './FormSection.svelte';

	// The fields of a tenant, shared by /mieter/neu and /mieter/[id]/bearbeiten. Values are the
	// strings of the last submit (or the tenant's columns), so a failed submit keeps what was typed.
	let {
		action,
		values,
		errors,
		submitLabel,
		cancelHref,
		returnTo = null,
		leaseAddress = null
	}: {
		action: string;
		values: Record<string, string>;
		errors: Partial<Record<string, string>>;
		submitLabel: string;
		cancelHref: string;
		/** Where to go after creating, carried as a hidden field (see /mieter/neu). */
		returnTo?: string | null;
		/** The address of the tenant's rented unit, when a lease exists, for the hint. */
		leaseAddress?: string | null;
	} = $props();

	// A tenant usually lives in the rented unit: letters then go to the address of the lease's
	// property, and nothing has to be typed. Only a different postal address shows the fields.
	// svelte-ignore state_referenced_locally
	let separate = $state(
		values.separateAddress === 'on' || Boolean(values.street || values.postalCode || values.city)
	);
</script>

<form method="POST" {action} class="card" use:enhance>
	{#if returnTo}<input type="hidden" name="return" value={returnTo} />{/if}
	<FormSection
		title="Person"
		description="So erscheint der Mieter in Listen, Verträgen und Schreiben."
	>
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
	</FormSection>
	<FormSection title="Kontakt" description="Wie du den Mieter erreichst.">
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
	</FormSection>
	<FormSection title="Anschrift" description="Wohin Schreiben an den Mieter gehen.">
		<div class="form-wide address">
			<input type="hidden" name="addressChoice" value="1" />
			<label class="inline">
				<input type="checkbox" name="separateAddress" bind:checked={separate} />
				Andere Postanschrift als die gemietete Einheit
			</label>
			{#if !separate}
				<p class="muted small">
					{#if leaseAddress}
						Schreiben gehen an {leaseAddress}, die Adresse aus dem Mietvertrag.
					{:else}
						Schreiben gehen an die Adresse der gemieteten Einheit; sie kommt aus dem Mietvertrag.
					{/if}
				</p>
			{/if}
		</div>
		{#if separate}
			<Field label="Straße und Hausnummer" error={errors.street}>
				<input
					name="street"
					defaultValue={values.street ?? ''}
					autocomplete="off"
					aria-invalid={errors.street ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Postleitzahl" error={errors.postalCode}>
				<input
					name="postalCode"
					defaultValue={values.postalCode ?? ''}
					inputmode="numeric"
					autocomplete="off"
					aria-invalid={errors.postalCode ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Ort" error={errors.city}>
				<input
					name="city"
					defaultValue={values.city ?? ''}
					autocomplete="off"
					aria-invalid={errors.city ? 'true' : undefined}
					required
				/>
			</Field>
		{/if}
	</FormSection>
	<FormSection title="Notizen">
		<div class="form-wide">
			<Field label="Notizen (optional)" error={errors.notes}>
				<textarea name="notes" aria-invalid={errors.notes ? 'true' : undefined}
					>{values.notes ?? ''}</textarea
				>
			</Field>
		</div>
	</FormSection>
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
		<a href={cancelHref} class="button secondary">Abbrechen</a>
	</div>
</form>

<style>
	.address p {
		margin: 0.25rem 0 0;
	}
</style>
