<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The form reads only the answer addressed to it; `form.form` names the one that answered.
	const landlord = $derived(form?.form === 'landlord' ? form : undefined);
	const landlordErrors = $derived(landlord && 'errors' in landlord ? landlord.errors : undefined);
	const landlordValues = $derived(
		landlord?.values ?? {
			landlordName: data.landlord.landlordName ?? '',
			street: data.landlord.street ?? '',
			postalCode: data.landlord.postalCode ?? '',
			city: data.landlord.city ?? '',
			iban: data.landlord.iban ?? '',
			bankName: data.landlord.bankName ?? ''
		}
	);
</script>

<PageHeader title="Profil" back={{ href: '/einstellungen', label: 'Einstellungen' }} />

<div class="stack">
	<section>
		<h2>Vermieter (Absender)</h2>
		<p class="muted">
			Briefe und Betriebskostenabrechnungen drucken diese Angaben als Absender; die IBAN steht auf
			der Abrechnung für Nachzahlungen. Solange der Block leer ist, steht der Name deines Kontos
			dort.
		</p>
		{#if landlord && 'saved' in landlord}
			<Alert tone="success"><p>Der Absender wurde gespeichert.</p></Alert>
		{/if}
		<form method="POST" action="?/landlord" class="card" use:enhance>
			<label>
				Name des Vermieters
				<input
					name="landlordName"
					defaultValue={landlordValues.landlordName ?? ''}
					aria-invalid={landlordErrors?.landlordName ? 'true' : undefined}
				/>
				{#if landlordErrors?.landlordName}
					<span class="error">{landlordErrors.landlordName}</span>
				{/if}
			</label>
			<label>
				Straße und Hausnummer
				<input
					name="street"
					defaultValue={landlordValues.street ?? ''}
					aria-invalid={landlordErrors?.street ? 'true' : undefined}
				/>
				{#if landlordErrors?.street}<span class="error">{landlordErrors.street}</span>{/if}
			</label>
			<label>
				Postleitzahl
				<input
					name="postalCode"
					defaultValue={landlordValues.postalCode ?? ''}
					inputmode="numeric"
					aria-invalid={landlordErrors?.postalCode ? 'true' : undefined}
				/>
				{#if landlordErrors?.postalCode}
					<span class="error">{landlordErrors.postalCode}</span>
				{/if}
			</label>
			<label>
				Ort
				<input
					name="city"
					defaultValue={landlordValues.city ?? ''}
					aria-invalid={landlordErrors?.city ? 'true' : undefined}
				/>
				{#if landlordErrors?.city}<span class="error">{landlordErrors.city}</span>{/if}
			</label>
			<label>
				IBAN
				<input
					name="iban"
					defaultValue={landlordValues.iban ?? ''}
					aria-invalid={landlordErrors?.iban ? 'true' : undefined}
				/>
				{#if landlordErrors?.iban}<span class="error">{landlordErrors.iban}</span>{/if}
			</label>
			<label>
				Bank
				<input
					name="bankName"
					defaultValue={landlordValues.bankName ?? ''}
					aria-invalid={landlordErrors?.bankName ? 'true' : undefined}
				/>
				{#if landlordErrors?.bankName}<span class="error">{landlordErrors.bankName}</span>{/if}
			</label>
			<div class="form-actions">
				<button type="submit">Absender speichern</button>
			</div>
		</form>
	</section>
</div>
