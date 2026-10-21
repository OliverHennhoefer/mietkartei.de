<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		heatingCostModelLabels,
		leaseKindLabels,
		operatingCostModelLabels,
		rentModelLabels,
		terminatedByLabels
	} from '../labels';
	import { personName } from '../format';
	import type {
		HeatingCostModel,
		LeaseKind,
		OperatingCostModel,
		RentModel,
		TerminatedBy
	} from '../server/db/schema';
	import type { LeaseSummary, Property, Tenant, Unit } from '../server/leases';
	import Field from './Field.svelte';

	// The lease form, shared by /vertraege/neu (mode create: units and amounts included) and
	// /vertraege/[id]/bearbeiten (mode edit: the units are shown, not edited; the amounts, deposit
	// and persons at the start of the lease and the notice fields are edited). Values are the
	// strings of the last submit or the defaults of the page.
	let {
		mode,
		action,
		values,
		errors,
		tenants,
		units = [],
		lease,
		depositWarning,
		submitLabel,
		cancelHref
	}: {
		mode: 'create' | 'edit';
		action: string;
		values: Record<string, string>;
		errors: Partial<Record<string, string>>;
		tenants: Tenant[];
		units?: { unit: Unit; property: Property }[];
		lease?: LeaseSummary;
		depositWarning?: string;
		submitLabel: string;
		cancelHref: string;
	} = $props();

	// The enum values come from the label tables: a component must not import the server schema.
	const leaseKinds = Object.keys(leaseKindLabels) as LeaseKind[];
	const rentModels = Object.keys(rentModelLabels) as RentModel[];
	const operatingCostModels = Object.keys(operatingCostModelLabels) as OperatingCostModel[];
	const heatingCostModels = Object.keys(heatingCostModelLabels) as HeatingCostModel[];
	const terminatedByParties = Object.keys(terminatedByLabels) as TerminatedBy[];

	const selectedTenants = $derived(new Set((values.tenantIds ?? '').split(',').filter(Boolean)));
	const selectedExtras = $derived(new Set((values.extraUnitIds ?? '').split(',').filter(Boolean)));
	const invalid = (name: string) => (errors[name] ? 'true' : undefined);
	// In the edit form the amounts are the ones at the start of the lease.
	const atStart = (label: string) => (mode === 'edit' ? `${label} bei Vertragsbeginn` : label);
</script>

<form method="POST" {action} class="card" use:enhance>
	{#if mode === 'create'}
		<Field label="Einheit" error={errors.unitId}>
			<select name="unitId" aria-invalid={invalid('unitId')} required>
				<option value="" selected={!values.unitId}>Bitte wählen</option>
				{#each units as { unit, property } (unit.id)}
					<option value={unit.id} selected={values.unitId === unit.id}>
						{unit.name} · {property.name}
					</option>
				{/each}
			</select>
		</Field>
		<fieldset class="form-wide">
			<legend>Weitere Einheiten (optional)</legend>
			<p class="muted small">
				Ein Stellplatz, der mit der Wohnung vermietet wird, gehört in denselben Mietvertrag: eine
				Miete, eine Kaution, eine Kündigung.
			</p>
			<div class="choices">
				{#each units as { unit, property } (unit.id)}
					<label class="inline">
						<input
							type="checkbox"
							name="extraUnitIds"
							value={unit.id}
							defaultChecked={selectedExtras.has(unit.id)}
						/>
						{unit.name} · {property.name}
					</label>
				{/each}
			</div>
			{#if errors.extraUnitIds}<span class="error">{errors.extraUnitIds}</span>{/if}
		</fieldset>
	{:else if lease}
		<div class="form-wide">
			<p>
				<strong>Einheiten:</strong>
				{lease.unit.name} · {lease.property.name}{#each lease.extraUnits as unit (unit.id)}, {unit.name}{/each}
			</p>
			<p class="muted small">
				Die Einheiten eines laufenden Vertrags lassen sich nicht ändern. Beende den Vertrag und lege
				einen neuen an.
			</p>
		</div>
	{/if}

	<fieldset class="form-wide">
		<legend>Mieter</legend>
		<div class="choices">
			{#each tenants as tenant (tenant.id)}
				<label class="inline">
					<input
						type="checkbox"
						name="tenantIds"
						value={tenant.id}
						defaultChecked={selectedTenants.has(tenant.id)}
					/>
					{personName(tenant)}
				</label>
			{/each}
		</div>
		{#if errors.tenantIds}<span class="error">{errors.tenantIds}</span>{/if}
	</fieldset>

	<Field label="Beginn" error={errors.startDate}>
		<input
			name="startDate"
			type="date"
			defaultValue={values.startDate ?? ''}
			aria-invalid={invalid('startDate')}
			required
		/>
	</Field>
	<Field
		label="Vertragsende (optional)"
		error={errors.endDate}
		hint="Leer bei unbefristeten Verträgen."
	>
		<input
			name="endDate"
			type="date"
			defaultValue={values.endDate ?? ''}
			aria-invalid={invalid('endDate')}
		/>
	</Field>

	<Field
		label="Art des Mietverhältnisses"
		error={errors.kind}
		hint="Vorbelegt mit Wohnraum; für einen Stellplatz oder ein Gewerbe bitte anpassen. Die Kaution nach § 551 BGB gilt nur für Wohnraum, die Kündigungsfristen richten sich nach der Art."
	>
		<select name="kind" aria-invalid={invalid('kind')} required>
			{#each leaseKinds as kind (kind)}
				<option value={kind} selected={(values.kind || 'residential') === kind}>
					{leaseKindLabels[kind]}
				</option>
			{/each}
		</select>
	</Field>
	<Field label="Mietmodell" error={errors.rentModel}>
		<select name="rentModel" aria-invalid={invalid('rentModel')} required>
			{#each rentModels as model (model)}
				<option value={model} selected={(values.rentModel || 'fixed') === model}>
					{rentModelLabels[model]}
				</option>
			{/each}
		</select>
	</Field>
	<Field label="Betriebskosten" error={errors.operatingCostModel}>
		<select name="operatingCostModel" aria-invalid={invalid('operatingCostModel')} required>
			{#each operatingCostModels as model (model)}
				<option value={model} selected={(values.operatingCostModel || 'prepayment') === model}>
					{operatingCostModelLabels[model]}
				</option>
			{/each}
		</select>
	</Field>
	<Field label="Heizkosten" error={errors.heatingCostModel}>
		<select name="heatingCostModel" aria-invalid={invalid('heatingCostModel')} required>
			{#each heatingCostModels as model (model)}
				<option value={model} selected={(values.heatingCostModel || 'prepayment') === model}>
					{heatingCostModelLabels[model]}
				</option>
			{/each}
		</select>
	</Field>

	{#if mode === 'edit'}
		<p class="form-wide muted small">
			Die Beträge und die Personenzahl hier gelten ab Vertragsbeginn. Den späteren Personenstand
			pflegst du in der Übersicht.
		</p>
	{/if}
	<Field label={atStart('Kaltmiete')} error={errors.baseRent}>
		<input
			name="baseRent"
			defaultValue={values.baseRent ?? ''}
			inputmode="decimal"
			placeholder="650,00"
			aria-invalid={invalid('baseRent')}
			required
		/>
	</Field>
	<Field label={atStart('Betriebskostenvorauszahlung')} error={errors.operatingCostPrepayment}>
		<input
			name="operatingCostPrepayment"
			defaultValue={values.operatingCostPrepayment ?? ''}
			inputmode="decimal"
			placeholder="0,00"
			aria-invalid={invalid('operatingCostPrepayment')}
		/>
	</Field>
	<Field label={atStart('Heizkostenvorauszahlung')} error={errors.heatingCostPrepayment}>
		<input
			name="heatingCostPrepayment"
			defaultValue={values.heatingCostPrepayment ?? ''}
			inputmode="decimal"
			placeholder="0,00"
			aria-invalid={invalid('heatingCostPrepayment')}
		/>
	</Field>
	<Field
		label="Kaution"
		error={errors.securityDeposit}
		hint={depositWarning ?? 'Bei Wohnraum höchstens drei Nettokaltmieten (§ 551 BGB).'}
	>
		<input
			name="securityDeposit"
			defaultValue={values.securityDeposit ?? ''}
			inputmode="decimal"
			placeholder="0,00"
			aria-invalid={invalid('securityDeposit')}
		/>
	</Field>
	<Field
		label="Personen bei Einzug"
		error={errors.persons}
		hint="Für den Umlageschlüssel nach Personen."
	>
		<input
			name="persons"
			type="number"
			min="0"
			max="20"
			defaultValue={values.persons || '1'}
			aria-invalid={invalid('persons')}
		/>
	</Field>

	{#if mode === 'edit'}
		<Field label="Kündigung erhalten am (optional)" error={errors.terminatedAt}>
			<input
				name="terminatedAt"
				type="date"
				defaultValue={values.terminatedAt ?? ''}
				aria-invalid={invalid('terminatedAt')}
			/>
		</Field>
		<Field label="Gekündigt durch (optional)" error={errors.terminatedBy}>
			<select name="terminatedBy" aria-invalid={invalid('terminatedBy')}>
				<option value="" selected={!values.terminatedBy}>Keine Kündigung</option>
				{#each terminatedByParties as party (party)}
					<option value={party} selected={values.terminatedBy === party}>
						{terminatedByLabels[party]}
					</option>
				{/each}
			</select>
		</Field>
	{/if}

	<div class="form-wide">
		<Field label="Notizen (optional)" error={errors.notes}>
			<textarea name="notes" aria-invalid={invalid('notes')}>{values.notes ?? ''}</textarea>
		</Field>
	</div>

	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
		<a href={cancelHref} class="button secondary">Abbrechen</a>
	</div>
</form>

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	legend {
		font-weight: 500;
		font-size: 0.9rem;
		padding: 0;
		margin-bottom: 0.25rem;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.5rem;
	}
	.choices label {
		font-weight: 400;
	}
	fieldset p {
		margin: 0 0 0.5rem;
	}
</style>
