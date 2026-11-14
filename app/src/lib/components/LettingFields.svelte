<script lang="ts">
	import Field from './Field.svelte';
	import FormSection from './FormSection.svelte';

	// The terms of a Neuvermietung, shared by /vermietung/neu and the edit dialog of a letting.
	let {
		values,
		errors
	}: {
		values: Record<string, string>;
		errors?: Partial<Record<string, string>>;
	} = $props();
</script>

<FormSection
	title="Angebot"
	description="Die Miete, zu der du die Einheit anbietest. Sie steht auf der Selbstauskunft, ergibt die Mietbelastung der Interessenten und wird in den Mietvertrag übernommen."
>
	<Field label="Kaltmiete in €" error={errors?.baseRent}>
		<input
			name="baseRent"
			inputmode="decimal"
			defaultValue={values.baseRent ?? ''}
			aria-invalid={errors?.baseRent ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Betriebskostenvorauszahlung in €" error={errors?.operatingCostPrepayment}>
		<input
			name="operatingCostPrepayment"
			inputmode="decimal"
			defaultValue={values.operatingCostPrepayment ?? ''}
			aria-invalid={errors?.operatingCostPrepayment ? 'true' : undefined}
		/>
	</Field>
	<Field label="Heizkostenvorauszahlung in €" error={errors?.heatingCostPrepayment}>
		<input
			name="heatingCostPrepayment"
			inputmode="decimal"
			defaultValue={values.heatingCostPrepayment ?? ''}
			aria-invalid={errors?.heatingCostPrepayment ? 'true' : undefined}
		/>
	</Field>
	<Field label="Kaution in €" error={errors?.securityDeposit}>
		<input
			name="securityDeposit"
			inputmode="decimal"
			defaultValue={values.securityDeposit ?? ''}
			aria-invalid={errors?.securityDeposit ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Frei ab (optional)"
		hint="Leer lassen für „nach Absprache“."
		error={errors?.availableFrom}
	>
		<input
			type="date"
			name="availableFrom"
			defaultValue={values.availableFrom ?? ''}
			aria-invalid={errors?.availableFrom ? 'true' : undefined}
		/>
	</Field>
	<label class="inline form-wide">
		<input type="checkbox" name="requiresWbs" checked={values.requiresWbs === 'on'} />
		Geförderter Wohnraum: Wohnberechtigungsschein nötig
	</label>
	<Field label="Notizen (optional)" error={errors?.notes}>
		<textarea name="notes" aria-invalid={errors?.notes ? 'true' : undefined}
			>{values.notes ?? ''}</textarea
		>
	</Field>
</FormSection>
