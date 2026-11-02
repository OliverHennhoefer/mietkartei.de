<script lang="ts">
	import Field from './Field.svelte';
	import { formatShareOf, parseDecimal } from '../format';
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

	// The MEA as typed, for the share of the WEG shown under the fields.
	// svelte-ignore state_referenced_locally
	let share = $state(initial('ownershipShare', decimal(property?.ownershipShare)));
	// svelte-ignore state_referenced_locally
	let shareTotal = $state(initial('ownershipShareTotal', decimal(property?.ownershipShareTotal)));
	const percentage = $derived.by(() => {
		const part = parseDecimal(share);
		const whole = parseDecimal(shareTotal);
		if (part === null || whole === null || part <= 0 || part > whole) return undefined;
		return `Ergibt einen Miteigentumsanteil von ${formatShareOf(part, whole)}.`;
	});
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
	<fieldset class="association form-wide">
		<legend>Wohnungseigentümergemeinschaft (WEG)</legend>
		<p class="muted small">
			Den Miteigentumsanteil (MEA) findest du in der Teilungserklärung oder auf der
			Hausgeldabrechnung, meist als Bruch wie „85/1.000“. Die erste Zahl ist der Anteil dieser
			Wohnung, die zweite die Summe der Anteile aller Wohnungen der WEG. In diesem Verhältnis
			verteilt der Verwalter die Kosten der WEG auf die Wohnungen.
		</p>
		<div class="form">
			<Field label="Verwalter" error={errors?.associationManager} hint="Der Verwalter der WEG.">
				<input
					name="associationManager"
					defaultValue={initial('associationManager', property?.associationManager)}
					aria-invalid={errors?.associationManager ? 'true' : undefined}
				/>
			</Field>
			<Field
				label="MEA dieser Wohnung"
				error={errors?.ownershipShare}
				hint="Die erste Zahl des Bruchs, bei 85/1.000 also 85."
			>
				<input
					name="ownershipShare"
					inputmode="decimal"
					placeholder="z. B. 85"
					defaultValue={share}
					oninput={(event) => (share = event.currentTarget.value)}
					aria-invalid={errors?.ownershipShare ? 'true' : undefined}
				/>
			</Field>
			<Field
				label="MEA der ganzen WEG"
				error={errors?.ownershipShareTotal}
				hint="Die zweite Zahl des Bruchs: alle Anteile der WEG zusammen, meist 1000 oder 10000 (ohne Punkt eingeben)."
				note={percentage}
			>
				<input
					name="ownershipShareTotal"
					inputmode="decimal"
					placeholder="z. B. 1000"
					defaultValue={shareTotal}
					oninput={(event) => (shareTotal = event.currentTarget.value)}
					aria-invalid={errors?.ownershipShareTotal ? 'true' : undefined}
				/>
			</Field>
		</div>
	</fieldset>
	<!-- A single flat has no other tenants a vacancy could shift costs to: the count stays as is. -->
	<input
		type="hidden"
		name="vacancyPersons"
		value={initial('vacancyPersons', property?.vacancyPersons ?? 1)}
	/>
{:else}
	<Field
		label="Personen bei Leerstand"
		error={errors?.vacancyPersons}
		hint="Nur für Kosten, die nach Personen verteilt werden, z. B. Müll oder Wasser: Eine leerstehende Wohnung zählt mit so vielen Personen, und diesen Anteil trägst du selbst. Bei 0 würden die übrigen Mieter die leere Wohnung mitbezahlen, das Leerstandsrisiko liegt aber bei dir. Üblich ist 1."
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
{/if}
<div class="form-wide">
	<Field label="Notizen" error={errors?.notes}>
		<textarea name="notes" defaultValue={initial('notes', property?.notes)}></textarea>
	</Field>
</div>

<style>
	.association {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 0.75rem 1rem 1rem;
		margin: 0;
		min-width: 0;
	}
	.association legend {
		font-weight: 500;
		font-size: var(--text-base);
		padding: 0 0.25rem;
	}
	.association p {
		margin: 0 0 0.75rem;
	}
</style>
