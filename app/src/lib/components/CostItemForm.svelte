<script lang="ts">
	import { enhance } from '$app/forms';
	import { today } from '../dates';
	import { CIRCLE_FROM_CATEGORY, defaultCostPeriod } from '../domain/operating-costs';
	import type { FieldErrors } from '../forms/fields';
	import type { CostItemForm } from '../forms/operating-costs';
	import { fuelLabels } from '../labels';
	import type { Fuel } from '../server/db/schema';
	import { formatCentsPlain } from '../money';
	import type { CostItemSummary } from '../server/operating-costs/cost-items';

	// The fuel list comes from the labels: schema.ts is server-only code.
	const fuels = Object.keys(fuelLabels) as Fuel[];

	// The one form of a Beleg, for creating (/belege/neu) and editing (/belege/[id]). The key and
	// circle selects offer "Standard der Kostenart", which the action resolves to the category's
	// defaults. Keys and circles are narrowed to the chosen property.
	let {
		action,
		properties,
		categories,
		keys,
		circles,
		item,
		prefill,
		errors,
		values,
		withNext = false
	}: {
		action: string;
		properties: { id: string; name: string }[];
		categories: { id: string; name: string; betrkvItem: number | null; allocable: boolean }[];
		keys: { id: string; name: string; propertyId: string | null }[];
		circles: { id: string; name: string; propertyId: string; propertyName: string }[];
		item?: CostItemSummary;
		prefill?: { propertyId?: string; periodStart?: string; periodEnd?: string };
		errors?: FieldErrors<CostItemForm>;
		values?: Record<string, string>;
		/** Show "Speichern und nächsten Beleg" (creating only). */
		withNext?: boolean;
	} = $props();

	const value = (name: string, fallback: string) => values?.[name] ?? fallback;
	const period = defaultCostPeriod(null, today());

	// The selects start from the typed values, the item or the prefill, then follow the user.
	// svelte-ignore state_referenced_locally
	let propertyId = $state(
		values?.propertyId ?? item?.propertyId ?? prefill?.propertyId ?? properties[0]?.id ?? ''
	);
	// svelte-ignore state_referenced_locally
	let categoryId = $state(values?.categoryId ?? item?.categoryId ?? categories[0]?.id ?? '');
	// svelte-ignore state_referenced_locally
	let allocable = $state(
		values ? values.allocable === 'on' : (item?.allocable ?? categories[0]?.allocable ?? true)
	);
	// svelte-ignore state_referenced_locally
	let fuel = $state(values?.fuel ?? item?.fuel ?? '');

	const propertyKeys = $derived(
		keys.filter((key) => key.propertyId === null || key.propertyId === propertyId)
	);
	const propertyCircles = $derived(circles.filter((circle) => circle.propertyId === propertyId));

	/** The allocable checkbox follows the category until the user ticks it. */
	function categoryChanged() {
		const category = categories.find((candidate) => candidate.id === categoryId);
		if (category) allocable = category.allocable;
	}

	const keyChoice = $derived(value('allocationKeyId', item?.allocationKeyId ?? ''));
	const circleChoice = $derived(
		value('billingCircleId', item ? (item.billingCircleId ?? '') : CIRCLE_FROM_CATEGORY)
	);
</script>

<form method="POST" {action} class="card" enctype="multipart/form-data" use:enhance>
	<label>
		Objekt
		<select
			name="propertyId"
			bind:value={propertyId}
			aria-invalid={errors?.propertyId ? 'true' : undefined}
			required
		>
			{#each properties as property (property.id)}
				<option value={property.id}>{property.name}</option>
			{/each}
		</select>
		{#if errors?.propertyId}<span class="error">{errors.propertyId}</span>{/if}
	</label>
	<label>
		Kostenart
		<select
			name="categoryId"
			bind:value={categoryId}
			onchange={categoryChanged}
			aria-invalid={errors?.categoryId ? 'true' : undefined}
			required
		>
			{#each categories as category (category.id)}
				<option value={category.id}>
					{category.betrkvItem ? `${category.betrkvItem} ` : ''}{category.name}
				</option>
			{/each}
		</select>
		{#if errors?.categoryId}<span class="error">{errors.categoryId}</span>{/if}
	</label>
	<label>
		Umlageschlüssel
		<select name="allocationKeyId" aria-invalid={errors?.allocationKeyId ? 'true' : undefined}>
			<option value="" selected={keyChoice === ''}>Standard der Kostenart</option>
			{#each propertyKeys as key (key.id)}
				<option value={key.id} selected={keyChoice === key.id}>{key.name}</option>
			{/each}
		</select>
		{#if errors?.allocationKeyId}<span class="error">{errors.allocationKeyId}</span>{/if}
	</label>
	<label>
		Abrechnungskreis
		<select name="billingCircleId" aria-invalid={errors?.billingCircleId ? 'true' : undefined}>
			<option value={CIRCLE_FROM_CATEGORY} selected={circleChoice === CIRCLE_FROM_CATEGORY}>
				Standard der Kostenart
			</option>
			<option value="" selected={circleChoice === ''}>Alle Einheiten des Objekts</option>
			{#each propertyCircles as circle (circle.id)}
				<option value={circle.id} selected={circleChoice === circle.id}>
					{circle.propertyName} – {circle.name}
				</option>
			{/each}
		</select>
		{#if errors?.billingCircleId}<span class="error">{errors.billingCircleId}</span>{/if}
	</label>
	<label class="form-wide">
		Beschreibung
		<input
			name="description"
			defaultValue={value('description', item?.description ?? '')}
			placeholder="z. B. Grundsteuer 2025"
			aria-invalid={errors?.description ? 'true' : undefined}
			required
		/>
		{#if errors?.description}<span class="error">{errors.description}</span>{/if}
	</label>
	<label>
		Lieferant (optional)
		<input name="supplier" defaultValue={value('supplier', item?.supplier ?? '')} />
	</label>
	<label>
		Rechnungsdatum
		<input
			type="date"
			name="invoiceDate"
			defaultValue={value('invoiceDate', item?.invoiceDate ?? today())}
			aria-invalid={errors?.invoiceDate ? 'true' : undefined}
		/>
		{#if errors?.invoiceDate}<span class="error">{errors.invoiceDate}</span>{/if}
	</label>
	<label>
		Zeitraum von
		<input
			type="date"
			name="periodStart"
			defaultValue={value(
				'periodStart',
				item?.periodStart ?? prefill?.periodStart ?? period.periodStart
			)}
			aria-invalid={errors?.periodStart ? 'true' : undefined}
			required
		/>
		{#if errors?.periodStart}<span class="error">{errors.periodStart}</span>{/if}
	</label>
	<label>
		Zeitraum bis
		<input
			type="date"
			name="periodEnd"
			defaultValue={value('periodEnd', item?.periodEnd ?? prefill?.periodEnd ?? period.periodEnd)}
			aria-invalid={errors?.periodEnd ? 'true' : undefined}
			required
		/>
		{#if errors?.periodEnd}<span class="error">{errors.periodEnd}</span>{/if}
	</label>
	<label>
		Betrag in €
		<input
			name="amount"
			inputmode="decimal"
			defaultValue={value('amount', item ? formatCentsPlain(item.amount) : '')}
			aria-invalid={errors?.amount ? 'true' : undefined}
			required
		/>
		{#if errors?.amount}<span class="error">{errors.amount}</span>{/if}
	</label>
	<label class="inline">
		<input type="checkbox" name="allocable" bind:checked={allocable} />
		umlagefähig
	</label>

	<fieldset class="fuel form-wide">
		<legend>Brennstoffrechnung (für die CO₂-Kostenaufteilung)</legend>
		<p class="muted small">
			Nur für die Rechnung des Energieversorgers einer Zentralheizung: kWh, CO₂-Menge und
			CO₂-Kosten, wie sie auf der Rechnung stehen. Bei Erdgas, Heizöl und Flüssiggas kannst du die
			CO₂-Menge leer lassen; sie wird aus den kWh berechnet.
		</p>
		<div class="form">
			<label>
				Brennstoff
				<select name="fuel" bind:value={fuel}>
					<option value="">keiner</option>
					{#each fuels as candidate (candidate)}
						<option value={candidate}>{fuelLabels[candidate]}</option>
					{/each}
				</select>
			</label>
			<label>
				Energiemenge in kWh
				<input
					name="fuelKwh"
					inputmode="decimal"
					defaultValue={value('fuelKwh', item?.fuelKwh?.toString() ?? '')}
					aria-invalid={errors?.fuelKwh ? 'true' : undefined}
				/>
				{#if errors?.fuelKwh}<span class="error">{errors.fuelKwh}</span>{/if}
			</label>
			<label>
				CO₂-Menge in kg
				<input
					name="co2Kg"
					inputmode="decimal"
					defaultValue={value('co2Kg', item?.co2Kg?.toString() ?? '')}
					aria-invalid={errors?.co2Kg ? 'true' : undefined}
				/>
				{#if errors?.co2Kg}<span class="error">{errors.co2Kg}</span>{/if}
			</label>
			<label>
				CO₂-Kosten in €
				<input
					name="co2Cost"
					inputmode="decimal"
					defaultValue={value('co2Cost', item?.co2Cost ? formatCentsPlain(item.co2Cost) : '')}
					aria-invalid={errors?.co2Cost ? 'true' : undefined}
				/>
				{#if errors?.co2Cost}<span class="error">{errors.co2Cost}</span>{/if}
			</label>
		</div>
	</fieldset>

	<label class="form-wide">
		Beleg als Datei (optional, höchstens 10 MB)
		<input type="file" name="receipt" aria-invalid={errors?.receipt ? 'true' : undefined} />
		{#if errors?.receipt}<span class="error">{errors.receipt}</span>{/if}
	</label>

	<div class="form-actions">
		<button type="submit">Speichern</button>
		{#if withNext}
			<button type="submit" name="next" value="1" class="secondary"
				>Speichern und nächsten Beleg</button
			>
		{/if}
	</div>
</form>

<style>
	.fuel {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 0.75rem 1rem 1rem;
		margin: 0;
	}
	.fuel legend {
		font-weight: 500;
		font-size: 0.9rem;
		padding: 0 0.25rem;
	}
	.fuel p {
		margin: 0 0 0.75rem;
	}
</style>
