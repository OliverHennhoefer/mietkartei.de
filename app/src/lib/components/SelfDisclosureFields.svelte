<script lang="ts">
	import Field from './Field.svelte';
	import FormSection from './FormSection.svelte';

	// The questions of the Mieterselbstauskunft, shared by the applicant's page in the app and the
	// page behind the secret link, where the applicant fills them in. Only what the DSK
	// Orientierungshilfe allows is asked, see domain/applicants.ts.
	let {
		values,
		errors,
		requiresWbs,
		applicant = false
	}: {
		values: Record<string, string>;
		errors?: Partial<Record<string, string>>;
		requiresWbs: boolean;
		/** Filled in by the applicant: the descriptions speak to them. */
		applicant?: boolean;
	} = $props();

	const invalid = (name: string) => (errors?.[name] ? 'true' : undefined);
</script>

{#snippet text(
	name: string,
	label: string,
	options: { type?: string; autocomplete?: string; required?: boolean; placeholder?: string } = {}
)}
	<Field {label} error={errors?.[name]}>
		<input
			{name}
			type={options.type ?? 'text'}
			autocomplete={options.autocomplete as never}
			placeholder={options.placeholder}
			defaultValue={values[name] ?? ''}
			aria-invalid={invalid(name)}
			required={options.required}
		/>
	</Field>
{/snippet}

{#snippet yesNo(name: string, label: string)}
	<Field {label} error={errors?.[name]}>
		<select {name} aria-invalid={invalid(name)}>
			<option value="" selected={!values[name]}>keine Angabe</option>
			<option value="nein" selected={values[name] === 'nein'}>nein</option>
			<option value="ja" selected={values[name] === 'ja'}>ja</option>
		</select>
	</Field>
{/snippet}

<FormSection
	title="Kontakt"
	description={applicant
		? 'Damit der Vermieter Sie erreicht. Pflicht sind nur Vor- und Nachname.'
		: 'Name und Kontakt; Pflicht sind nur Vor- und Nachname.'}
>
	{@render text('salutation', 'Anrede (optional)', { placeholder: 'z. B. Frau, Herr' })}
	{@render text('firstName', 'Vorname', { autocomplete: 'given-name', required: true })}
	{@render text('lastName', 'Nachname', { autocomplete: 'family-name', required: true })}
	{@render text('birthDate', 'Geburtsdatum (optional)', { type: 'date', autocomplete: 'bday' })}
	{@render text('email', 'E-Mail (optional)', { type: 'email', autocomplete: 'email' })}
	{@render text('phone', 'Telefon (optional)', { type: 'tel', autocomplete: 'tel' })}
	{@render text('street', 'Derzeitige Anschrift: Straße und Nr. (optional)', {
		autocomplete: 'street-address'
	})}
	{@render text('postalCode', 'PLZ (optional)', { autocomplete: 'postal-code' })}
	{@render text('city', 'Ort (optional)', { autocomplete: 'address-level2' })}
</FormSection>

<FormSection
	title="Haushalt und Einkommen"
	description={applicant
		? 'Alle Angaben sind freiwillig. Sie helfen dem Vermieter, über die Vermietung zu entscheiden.'
		: 'Was die Miete tragbar macht. Alle Angaben sind freiwillig.'}
>
	{@render text('adults', 'Einziehende Erwachsene', { type: 'number' })}
	{@render text('children', 'Einziehende Kinder', { type: 'number' })}
	{@render text('occupation', 'Beruf')}
	{@render text('employer', 'Arbeitgeber')}
	<Field
		label="Monatliches Nettoeinkommen des Haushalts in €"
		hint="Alle Einkünfte der Personen, die den Mietvertrag unterschreiben, nach Steuern und Abgaben."
		error={errors?.netIncome}
	>
		<input
			name="netIncome"
			inputmode="decimal"
			defaultValue={values.netIncome ?? ''}
			aria-invalid={invalid('netIncome')}
		/>
	</Field>
	{@render text('pets', 'Haustiere, die eine Erlaubnis brauchen', {
		placeholder: 'z. B. ein Hund; Kleintiere nicht angeben'
	})}
	{@render yesNo('insolvency', 'Läuft ein Verbraucherinsolvenzverfahren?')}
	{#if requiresWbs}{@render yesNo('hasWbs', 'Wohnberechtigungsschein vorhanden?')}{/if}
	{@render text('moveInDate', 'Gewünschter Einzug', { type: 'date' })}
</FormSection>

<FormSection
	title="Weitere Person"
	description="Nur wenn eine zweite Person den Mietvertrag mit unterschreibt."
>
	{@render text('coFirstName', 'Vorname der weiteren Person')}
	{@render text('coLastName', 'Nachname der weiteren Person')}
	{@render text('coBirthDate', 'Geburtsdatum der weiteren Person', { type: 'date' })}
	{@render text('coOccupation', 'Beruf der weiteren Person')}
	{@render text('coEmployer', 'Arbeitgeber der weiteren Person')}
</FormSection>

<FormSection
	title={applicant ? 'Nachricht' : 'Nachricht des Interessenten'}
	description={applicant ? 'Was Sie dem Vermieter noch sagen möchten.' : undefined}
>
	<Field label="Nachricht (optional)" error={errors?.message}>
		<textarea name="message" aria-invalid={invalid('message')}>{values.message ?? ''}</textarea>
	</Field>
</FormSection>
