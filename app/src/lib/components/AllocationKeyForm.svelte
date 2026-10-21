<script lang="ts">
	import { enhance } from '$app/forms';
	import type { FieldErrors } from '../forms/fields';
	import { allocationKeyKindLabels, meterKindLabels } from '../labels';
	import type { AllocationKeyKind, MeterKind } from '../server/db/schema';
	import type { AllocationKey, AllocationKeyInput } from '../server/operating-costs/keys';

	// The enum lists come from the labels: schema.ts is server-only code.
	const allocationKeyKinds = Object.keys(allocationKeyKindLabels) as AllocationKeyKind[];
	const meterKinds = Object.keys(meterKindLabels) as MeterKind[];

	// The fields of an Umlageschlüssel, used by the list page (create) and the detail page (edit).
	// The meter kind only matters for consumption and mixed keys, the percentage for mixed ones;
	// the kind select shows and hides them.
	let {
		action,
		submitLabel,
		properties,
		key,
		errors,
		values
	}: {
		action: string;
		submitLabel: string;
		properties: { id: string; name: string }[];
		key?: AllocationKey;
		errors?: FieldErrors<AllocationKeyInput>;
		values?: Record<string, string>;
	} = $props();

	const value = (name: string, fallback: string) => values?.[name] ?? fallback;

	// The kind select starts from the typed value or the key, then follows the user.
	// svelte-ignore state_referenced_locally
	let kind = $state(values?.kind ?? key?.kind ?? 'custom');
	const byMeter = $derived(kind === 'consumption' || kind === 'mixed');
</script>

<form method="POST" {action} class="card" use:enhance>
	<label>
		Bezeichnung
		<input
			name="name"
			defaultValue={value('name', key?.name ?? '')}
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
		{#if errors?.name}<span class="error">{errors.name}</span>{/if}
	</label>
	<label>
		Art
		<select name="kind" bind:value={kind} aria-invalid={errors?.kind ? 'true' : undefined} required>
			{#each allocationKeyKinds as candidate (candidate)}
				<option value={candidate}>{allocationKeyKindLabels[candidate]}</option>
			{/each}
		</select>
		{#if errors?.kind}<span class="error">{errors.kind}</span>{/if}
	</label>
	<label>
		Objekt
		<select name="propertyId" aria-invalid={errors?.propertyId ? 'true' : undefined}>
			<option value="" selected={value('propertyId', key?.propertyId ?? '') === ''}>
				alle Objekte
			</option>
			{#each properties as property (property.id)}
				<option
					value={property.id}
					selected={value('propertyId', key?.propertyId ?? '') === property.id}
				>
					{property.name}
				</option>
			{/each}
		</select>
		{#if errors?.propertyId}<span class="error">{errors.propertyId}</span
			>{:else if kind === 'custom'}
			<span class="hint muted">Eigene Anteile gelten für die Einheiten eines Objekts.</span>
		{/if}
	</label>
	{#if byMeter}
		<label>
			Zählerart
			<select name="meterKind" aria-invalid={errors?.meterKind ? 'true' : undefined}>
				{#each meterKinds as candidate (candidate)}
					<option
						value={candidate}
						selected={value('meterKind', key?.meterKind ?? 'heat') === candidate}
					>
						{meterKindLabels[candidate]}
					</option>
				{/each}
			</select>
			{#if errors?.meterKind}<span class="error">{errors.meterKind}</span>{/if}
		</label>
	{/if}
	{#if kind === 'mixed'}
		<label>
			Anteil nach Verbrauch in %
			<input
				name="consumptionPercent"
				inputmode="numeric"
				defaultValue={value('consumptionPercent', key?.consumptionPercent?.toString() ?? '70')}
				aria-invalid={errors?.consumptionPercent ? 'true' : undefined}
			/>
			{#if errors?.consumptionPercent}<span class="error">{errors.consumptionPercent}</span>{:else}
				<span class="hint muted"
					>Heizung und Warmwasser: 50 bis 70 % (§§ 7, 8 HeizKV), der Rest nach Fläche.</span
				>
			{/if}
		</label>
	{/if}
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
	</div>
</form>

<style>
	.hint {
		font-weight: 400;
		font-size: 0.85rem;
	}
</style>
