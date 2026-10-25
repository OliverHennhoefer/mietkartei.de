<script lang="ts">
	import Field from './Field.svelte';
	import { buildingUseLabels, propertyKindLabels, stateLabels } from '../labels';
	import type { BuildingUse, PropertyKind } from '../server/db/schema';
	import type { GermanState } from '../working-days';

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
			kind: PropertyKind;
			associationManager: string | null;
			ownershipShare: number | null;
			ownershipShareTotal: number | null;
			buildingUse: BuildingUse;
			state: GermanState | null;
			vacancyPersons: number;
			notes: string | null;
		};
	} = $props();

	const buildingUses = Object.entries(buildingUseLabels) as [BuildingUse, string][];
	const kinds = Object.entries(propertyKindLabels) as [PropertyKind, string][];
	const states = Object.entries(stateLabels) as [GermanState, string][];

	function initial(name: string, saved: string | number | null | undefined): string {
		if (values && name in values) return values[name];
		return saved === null || saved === undefined ? '' : String(saved);
	}

	/** A decimal as typed in Germany, e.g. 85,5. */
	function decimal(saved: number | null | undefined): string | null {
		return saved === null || saved === undefined ? null : String(saved).replace('.', ',');
	}

	// The WEG fields show while the kind is "Eigentumswohnung in einer WEG".
	// svelte-ignore state_referenced_locally
	let kind = $state(initial('kind', property?.kind ?? 'building'));
</script>

<Field
	label="Objektart"
	error={errors?.kind}
	hint="Bei einer Eigentumswohnung kommen die Kosten aus der Hausgeldabrechnung des Verwalters."
>
	<select name="kind" bind:value={kind} aria-invalid={errors?.kind ? 'true' : undefined}>
		{#each kinds as [value, label] (value)}
			<option {value}>{label}</option>
		{/each}
	</select>
</Field>

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
<Field
	label="Bundesland"
	error={errors?.state}
	hint="Für die Feiertage bei Fälligkeiten und Fristen. Ohne Angabe zählen nur die bundesweiten."
>
	<select name="state" aria-invalid={errors?.state ? 'true' : undefined}>
		<option value="" selected={initial('state', property?.state) === ''}>nicht angegeben</option>
		{#each states as [value, label] (value)}
			<option {value} selected={initial('state', property?.state) === value}>{label}</option>
		{/each}
	</select>
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
{#if kind === 'condominium'}
	<Field label="Verwalter" error={errors?.associationManager} hint="Der Verwalter der WEG.">
		<input
			name="associationManager"
			defaultValue={initial('associationManager', property?.associationManager)}
			aria-invalid={errors?.associationManager ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Miteigentumsanteil der Wohnung"
		error={errors?.ownershipShare}
		hint="Laut Teilungserklärung, z. B. 85."
	>
		<input
			name="ownershipShare"
			inputmode="decimal"
			defaultValue={initial('ownershipShare', decimal(property?.ownershipShare))}
			aria-invalid={errors?.ownershipShare ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Miteigentumsanteile der WEG"
		error={errors?.ownershipShareTotal}
		hint="Alle Anteile zusammen, z. B. 1000."
	>
		<input
			name="ownershipShareTotal"
			inputmode="decimal"
			defaultValue={initial('ownershipShareTotal', decimal(property?.ownershipShareTotal))}
			aria-invalid={errors?.ownershipShareTotal ? 'true' : undefined}
		/>
	</Field>
{/if}
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
