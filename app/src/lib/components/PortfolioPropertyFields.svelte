<script lang="ts">
	import Field from './Field.svelte';
	import { buildingUseLabels } from '../labels';
	import type { BuildingUse } from '../server/db/schema';

	// The fields of the property form, shared by /objekte/neu and /objekte/[id]/bearbeiten.
	// `values` are the strings a failed submit sent back, `property` the saved row when editing;
	// fields use defaultValue, not value, so hydration keeps anything typed before it.
	let {
		values,
		errors,
		property
	}: {
		values?: Record<string, string>;
		errors?: Partial<Record<string, string>>;
		property?: {
			name: string;
			street: string;
			postalCode: string;
			city: string;
			buildingUse: BuildingUse;
			vacancyPersons: number;
			notes: string | null;
		};
	} = $props();

	const buildingUses = Object.entries(buildingUseLabels) as [BuildingUse, string][];

	function initial(name: string, saved: string | number | null | undefined): string {
		if (values && name in values) return values[name];
		return saved === null || saved === undefined ? '' : String(saved);
	}
</script>

<Field label="Bezeichnung" error={errors?.name}>
	<input
		name="name"
		defaultValue={initial('name', property?.name)}
		placeholder="z. B. Mehrfamilienhaus Lindenstraße"
		aria-invalid={errors?.name ? 'true' : undefined}
		required
	/>
</Field>
<Field label="Straße und Hausnummer" error={errors?.street}>
	<input
		name="street"
		defaultValue={initial('street', property?.street)}
		autocomplete="street-address"
		aria-invalid={errors?.street ? 'true' : undefined}
		required
	/>
</Field>
<Field label="Postleitzahl" error={errors?.postalCode}>
	<input
		name="postalCode"
		defaultValue={initial('postalCode', property?.postalCode)}
		inputmode="numeric"
		autocomplete="postal-code"
		aria-invalid={errors?.postalCode ? 'true' : undefined}
		required
	/>
</Field>
<Field label="Ort" error={errors?.city}>
	<input
		name="city"
		defaultValue={initial('city', property?.city)}
		autocomplete="address-level2"
		aria-invalid={errors?.city ? 'true' : undefined}
		required
	/>
</Field>
<Field label="Gebäudeart" error={errors?.buildingUse} hint="Für die CO₂-Kostenaufteilung.">
	<select name="buildingUse" aria-invalid={errors?.buildingUse ? 'true' : undefined}>
		{#each buildingUses as [value, label] (value)}
			<option
				{value}
				selected={initial('buildingUse', property?.buildingUse ?? 'residential') === value}
			>
				{label}
			</option>
		{/each}
	</select>
</Field>
<Field
	label="Personen bei Leerstand"
	error={errors?.vacancyPersons}
	hint="Mit so vielen Personen zählt eine leerstehende Einheit beim Umlageschlüssel „Personen“; dieser Anteil bleibt bei dir."
>
	<input
		name="vacancyPersons"
		type="number"
		min="0"
		max="10"
		step="1"
		defaultValue={initial('vacancyPersons', property?.vacancyPersons ?? 1)}
		aria-invalid={errors?.vacancyPersons ? 'true' : undefined}
	/>
</Field>
<div class="form-wide">
	<Field label="Notizen" error={errors?.notes}>
		<textarea name="notes" defaultValue={initial('notes', property?.notes)}></textarea>
	</Field>
</div>
