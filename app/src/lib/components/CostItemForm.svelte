<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate, today } from '../dates';
	import { CIRCLE_FROM_CATEGORY, defaultCostPeriod } from '../domain/operating-costs';
	import type { FieldErrors } from '../forms/fields';
	import type { CostItemForm } from '../forms/operating-costs';
	import { fuelLabels } from '../labels';
	import { formatCents, formatCentsPlain } from '../money';
	import type { Fuel } from '../server/db/schema';
	import type { CostItemHistory, CostItemSummary } from '../server/operating-costs/cost-items';

	// The one form of a Beleg, for creating (/belege/neu) and editing (/belege/[id]). The key and
	// circle selects offer "Standard der Kostenart", which the action resolves to the category's
	// defaults. Keys and circles are narrowed to the chosen property. Earlier items feed the
	// suggestions of the text fields and, when creating, the "Übernehmen" of the last item of the
	// chosen property and category.

	// The fuel list comes from the labels: schema.ts is server-only code.
	const fuels = Object.keys(fuelLabels) as Fuel[];

	let {
		action,
		properties,
		categories,
		keys,
		circles,
		item,
		history,
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
		history?: CostItemHistory;
		prefill?: {
			propertyId?: string;
			periodStart?: string;
			periodEnd?: string;
			categoryId?: string;
			description?: string;
			supplier?: string;
			amount?: number;
			allocable?: boolean;
			insurancePolicyId?: string;
		};
		errors?: FieldErrors<CostItemForm>;
		values?: Record<string, string>;
		/** Show "Speichern und nächsten Beleg" (creating only). */
		withNext?: boolean;
	} = $props();

	const value = (name: string, fallback: string) => values?.[name] ?? fallback;
	// Without a year from the list, the period is last year's: most receipts entered now, such as
	// an annual bill, belong to the statement of the year before. The hint says so.
	const period = defaultCostPeriod(null, today());
	const periodDefaulted = $derived(!values && !item && !prefill?.periodStart);

	// The selects start from the typed values, the item or the prefill, then follow the user.
	// svelte-ignore state_referenced_locally
	let propertyId = $state(
		values?.propertyId ?? item?.propertyId ?? prefill?.propertyId ?? properties[0]?.id ?? ''
	);
	// svelte-ignore state_referenced_locally
	let categoryId = $state(
		values?.categoryId ?? item?.categoryId ?? prefill?.categoryId ?? categories[0]?.id ?? ''
	);
	// svelte-ignore state_referenced_locally
	let allocable = $state(
		values
			? values.allocable === 'on'
			: (item?.allocable ??
					prefill?.allocable ??
					categories.find((category) => category.id === categoryId)?.allocable ??
					true)
	);

	const propertyKeys = $derived(
		keys.filter((key) => key.propertyId === null || key.propertyId === propertyId)
	);
	const propertyCircles = $derived(circles.filter((circle) => circle.propertyId === propertyId));

	/** The allocable checkbox follows the category until the user ticks it. */
	function categoryChanged() {
		const category = categories.find((candidate) => candidate.id === categoryId);
		if (category) allocable = category.allocable;
	}

	let formElement = $state<HTMLFormElement>();
	const lastItem = $derived(
		item
			? undefined
			: history?.last.find(
					(candidate) => candidate.propertyId === propertyId && candidate.categoryId === categoryId
				)
	);

	/** Sets a field of the form; a select only to one of its options. */
	function setField(name: string, value: string) {
		const field = formElement?.elements.namedItem(name);
		if (field instanceof HTMLSelectElement) {
			if ([...field.options].some((option) => option.value === value)) field.value = value;
		} else if (field instanceof HTMLInputElement) {
			field.value = value;
		}
	}

	/**
	 * Fills the form from the last item of the property and category: the yearly bill usually
	 * repeats with the same supplier, key and circle. A year in the description moves to the year
	 * of the period entered.
	 */
	function copyLast() {
		if (!lastItem || !formElement) return;
		const start = formElement.elements.namedItem('periodStart');
		const year = start instanceof HTMLInputElement ? start.value.slice(0, 4) : '';
		const lastYear = lastItem.periodEnd.slice(0, 4);
		setField(
			'description',
			/^\d{4}$/.test(year)
				? lastItem.description.replace(new RegExp(`\\b${lastYear}\\b`, 'g'), year)
				: lastItem.description
		);
		setField('supplier', lastItem.supplier ?? '');
		setField('amount', formatCentsPlain(lastItem.amount));
		setField('allocationKeyId', lastItem.allocationKeyId);
		setField('billingCircleId', lastItem.billingCircleId ?? '');
	}

	const fuelChoice = $derived(value('fuel', item?.fuel ?? ''));
	const keyChoice = $derived(value('allocationKeyId', item?.allocationKeyId ?? ''));
	const circleChoice = $derived(
		value('billingCircleId', item ? (item.billingCircleId ?? '') : CIRCLE_FROM_CATEGORY)
	);
</script>

<form
	method="POST"
	{action}
	class="card"
	enctype="multipart/form-data"
	bind:this={formElement}
	use:enhance
>
	{#if prefill?.insurancePolicyId}
		<input type="hidden" name="insurancePolicyId" value={prefill.insurancePolicyId} />
	{/if}
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
	{#if lastItem}
		<p class="form-wide last muted small">
			<span>
				Letzter Beleg dieser Kostenart: {lastItem.supplier ?? lastItem.description} ·
				{formatCents(lastItem.amount)} · bis {formatDate(lastItem.periodEnd)}
			</span>
			<button type="button" class="secondary small" onclick={copyLast}>Übernehmen</button>
		</p>
	{/if}
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
			defaultValue={value('description', item?.description ?? prefill?.description ?? '')}
			list={history?.descriptions.length ? 'cost-item-descriptions' : undefined}
			autocomplete="off"
			placeholder="z. B. Grundsteuer 2025"
			aria-invalid={errors?.description ? 'true' : undefined}
			required
		/>
		{#if errors?.description}<span class="error">{errors.description}</span>{/if}
	</label>
	<label>
		Lieferant (optional)
		<input
			name="supplier"
			defaultValue={value('supplier', item?.supplier ?? prefill?.supplier ?? '')}
			list={history?.suppliers.length ? 'cost-item-suppliers' : undefined}
			autocomplete="off"
			aria-invalid={errors?.supplier ? 'true' : undefined}
		/>
		{#if errors?.supplier}<span class="error">{errors.supplier}</span>{/if}
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
		{#if errors?.periodStart}<span class="error">{errors.periodStart}</span
			>{:else if periodDefaulted}
			<span class="hint muted"
				>Vorbelegt mit dem Vorjahr, für die Abrechnung des letzten Jahres.</span
			>
		{/if}
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
			defaultValue={value(
				'amount',
				item
					? formatCentsPlain(item.amount)
					: prefill?.amount !== undefined
						? formatCentsPlain(prefill.amount)
						: ''
			)}
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
				<select name="fuel" aria-invalid={errors?.fuel ? 'true' : undefined}>
					<option value="" selected={fuelChoice === ''}>keiner</option>
					{#each fuels as candidate (candidate)}
						<option value={candidate} selected={fuelChoice === candidate}
							>{fuelLabels[candidate]}</option
						>
					{/each}
				</select>
				{#if errors?.fuel}<span class="error">{errors.fuel}</span>{/if}
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

	{#if history}
		<datalist id="cost-item-descriptions">
			{#each history.descriptions as text (text)}<option value={text}></option>{/each}
		</datalist>
		<datalist id="cost-item-suppliers">
			{#each history.suppliers as text (text)}<option value={text}></option>{/each}
		</datalist>
	{/if}

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
	.last {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		margin: 0;
	}
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
