<script lang="ts">
	import { enhance } from '$app/forms';
	import type { FieldErrors } from '../forms/fields';
	import type { BillingCircleInput } from '../server/operating-costs/circles';
	import { unitKindLabels } from '../units';

	// Name and unit checkboxes of an Abrechnungskreis, for creating and editing.
	let {
		action,
		submitLabel,
		units,
		circle,
		errors,
		values
	}: {
		action: string;
		submitLabel: string;
		units: { id: string; name: string; kind: keyof typeof unitKindLabels }[];
		circle?: { name: string; unitIds: string[] };
		errors?: FieldErrors<BillingCircleInput>;
		values?: Record<string, string>;
	} = $props();

	const chosen = $derived(
		values
			? new Set(values.unitIds ? values.unitIds.split(',') : [])
			: new Set(circle?.unitIds ?? [])
	);
</script>

<form method="POST" {action} class="card" use:enhance>
	<label>
		Bezeichnung
		<input
			name="name"
			defaultValue={values?.name ?? circle?.name ?? ''}
			placeholder="z. B. Haus A, Stellplätze"
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
		{#if errors?.name}<span class="error">{errors.name}</span>{/if}
	</label>
	<fieldset class="units form-wide">
		<legend>Einheiten im Abrechnungskreis</legend>
		{#if units.length === 0}
			<p class="muted">Das Objekt hat noch keine Einheiten.</p>
		{/if}
		{#each units as unit (unit.id)}
			<label class="inline">
				<input type="checkbox" name="unitIds" value={unit.id} checked={chosen.has(unit.id)} />
				{unit.name}
				<span class="muted">({unitKindLabels[unit.kind]})</span>
			</label>
		{/each}
		{#if errors?.unitIds}<span class="error">{errors.unitIds}</span>{/if}
	</fieldset>
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
	</div>
</form>

<style>
	.units {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.35rem;
	}
	.units legend {
		font-weight: 500;
		font-size: var(--text-base);
		margin-bottom: 0.25rem;
	}
</style>
