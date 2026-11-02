<script lang="ts">
	import Field from './Field.svelte';
	import FormSection from './FormSection.svelte';
	import { enhance } from '$app/forms';
	import { formatDate, today } from '../dates';
	import { behgHint, co2KgFromKwh } from '../domain/co2';
	import { CIRCLE_FROM_CATEGORY, defaultCostPeriod } from '../domain/operating-costs';
	import { formatShareOf, parseDecimal } from '../format';
	import type { FieldErrors } from '../forms/fields';
	import type { CostItemForm } from '../forms/operating-costs';
	import { fuelLabels } from '../labels';
	import { formatCents, formatCentsPlain, parseCents } from '../money';
	import type { Fuel, PropertyKind } from '../server/db/schema';
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
		properties: {
			id: string;
			name: string;
			kind?: PropertyKind;
			associationManager?: string | null;
			ownershipShare?: number | null;
			ownershipShareTotal?: number | null;
		}[];
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
	const property = $derived(properties.find((candidate) => candidate.id === propertyId));
	/** The WEG figures show for an Eigentumswohnung, and for an item that already has them. */
	const condominium = $derived(
		property?.kind === 'condominium' || (item?.associationTotal ?? null) !== null
	);

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

	/** The fields the BEHG hint reads, as typed; null until the user types after a submit. */
	let typed = $state<Record<string, string> | null>(null);
	$effect(() => {
		void values;
		typed = null;
	});

	function readFuelFields(element: HTMLFormElement) {
		const entries = new FormData(element);
		typed = Object.fromEntries(
			[
				'periodStart',
				'periodEnd',
				'fuel',
				'fuelKwh',
				'co2Kg',
				'amount',
				'associationTotal',
				'associationKeyTotal',
				'associationKeyShare'
			].map((name) => [name, String(entries.get(name) ?? '')])
		);
	}

	/**
	 * What the emissions cost at the BEHG price, for a bill within one calendar year; a period
	 * across the turn of the year would mix two prices.
	 */
	const costHint = $derived.by(() => {
		const start =
			typed?.periodStart ??
			value('periodStart', item?.periodStart ?? prefill?.periodStart ?? period.periodStart);
		const end =
			typed?.periodEnd ??
			value('periodEnd', item?.periodEnd ?? prefill?.periodEnd ?? period.periodEnd);
		const year = start.slice(0, 4);
		if (!/^\d{4}$/.test(year) || end.slice(0, 4) !== year) return null;
		const fuel = typed?.fuel ?? fuelChoice;
		const kg =
			parseDecimal(typed?.co2Kg ?? value('co2Kg', item?.co2Kg?.toString() ?? '')) ??
			co2KgFromKwh(
				fuel,
				parseDecimal(typed?.fuelKwh ?? value('fuelKwh', item?.fuelKwh?.toString() ?? ''))
			);
		return kg === null ? null : behgHint(Number(year), kg);
	});

	/** A decimal for a field, as typed in Germany. */
	const decimal = (saved: number | null | undefined) =>
		saved === null || saved === undefined ? '' : String(saved).replace('.', ',');
	/** The WEG fields start from the item, else from the MEA of the property. */
	const associationValue = (
		name: 'associationKey' | 'associationKeyTotal' | 'associationKeyShare'
	) => {
		if (item) {
			if (name === 'associationKey') return value(name, item.associationKey ?? '');
			return value(name, decimal(item[name]));
		}
		if (name === 'associationKey') return value(name, 'MEA');
		return value(
			name,
			decimal(
				name === 'associationKeyTotal' ? property?.ownershipShareTotal : property?.ownershipShare
			)
		);
	};

	/** What the key of the WEG gives the property, next to the amount entered from the Verwalter. */
	const associationHint = $derived.by(() => {
		const read = (name: string, fallback: string) => typed?.[name] ?? value(name, fallback);
		const total = parseCents(
			read(
				'associationTotal',
				item?.associationTotal != null ? formatCentsPlain(item.associationTotal) : ''
			)
		);
		const keyTotal = parseDecimal(
			read('associationKeyTotal', associationValue('associationKeyTotal'))
		);
		const keyShare = parseDecimal(
			read('associationKeyShare', associationValue('associationKeyShare'))
		);
		if (total === undefined || !keyTotal || keyShare === null) return null;
		const share = Math.round((total * keyShare) / keyTotal);
		const amount = parseCents(read('amount', item ? formatCentsPlain(item.amount) : ''));
		const differs = amount !== undefined && Math.abs(amount - share) > 100;
		return `${formatShareOf(keyShare, keyTotal)} von ${formatCents(total)} sind ${formatCents(share)}${differs ? `; eingetragen sind ${formatCents(amount)}` : ''}.`;
	});
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
	oninput={(event) => readFuelFields(event.currentTarget)}
>
	{#if prefill?.insurancePolicyId}
		<input type="hidden" name="insurancePolicyId" value={prefill.insurancePolicyId} />
	{/if}
	<FormSection
		title="Kostenart"
		description="Wofür die Kosten anfallen und wie sie auf die Einheiten verteilt werden."
	>
		<Field label="Objekt" error={errors?.propertyId}>
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
		</Field>
		<Field label="Kostenart" error={errors?.categoryId}>
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
		</Field>
		{#if lastItem}
			<p class="form-wide last muted small">
				<span>
					Letzter Beleg dieser Kostenart: {lastItem.supplier ?? lastItem.description} ·
					{formatCents(lastItem.amount)} · bis {formatDate(lastItem.periodEnd)}
				</span>
				<button type="button" class="secondary small" onclick={copyLast}>Übernehmen</button>
			</p>
		{/if}
		<Field label="Umlageschlüssel" error={errors?.allocationKeyId}>
			<select name="allocationKeyId" aria-invalid={errors?.allocationKeyId ? 'true' : undefined}>
				<option value="" selected={keyChoice === ''}>Standard der Kostenart</option>
				{#each propertyKeys as key (key.id)}
					<option value={key.id} selected={keyChoice === key.id}>{key.name}</option>
				{/each}
			</select>
		</Field>
		<Field label="Abrechnungskreis" error={errors?.billingCircleId}>
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
		</Field>
	</FormSection>

	<FormSection
		title="Rechnung"
		description="Die Angaben, wie sie auf der Rechnung oder dem Bescheid stehen."
	>
		<div class="form-wide">
			<Field label="Beschreibung" error={errors?.description}>
				<input
					name="description"
					defaultValue={value('description', item?.description ?? prefill?.description ?? '')}
					list={history?.descriptions.length ? 'cost-item-descriptions' : undefined}
					autocomplete="off"
					placeholder="z. B. Grundsteuer 2025"
					aria-invalid={errors?.description ? 'true' : undefined}
					required
				/>
			</Field>
		</div>
		<Field label="Lieferant (optional)" error={errors?.supplier}>
			<input
				name="supplier"
				defaultValue={value('supplier', item?.supplier ?? prefill?.supplier ?? '')}
				list={history?.suppliers.length ? 'cost-item-suppliers' : undefined}
				autocomplete="off"
				aria-invalid={errors?.supplier ? 'true' : undefined}
			/>
		</Field>
		<Field label="Rechnungsdatum" error={errors?.invoiceDate}>
			<input
				type="date"
				name="invoiceDate"
				defaultValue={value('invoiceDate', item?.invoiceDate ?? today())}
				aria-invalid={errors?.invoiceDate ? 'true' : undefined}
			/>
		</Field>
		<Field label="Betrag in €" error={errors?.amount}>
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
		</Field>
		<label class="inline">
			<input type="checkbox" name="allocable" bind:checked={allocable} />
			umlagefähig
		</label>
	</FormSection>

	<FormSection
		title="Zeitraum"
		description="Für welchen Zeitraum die Kosten gelten; die Abrechnung verteilt sie anteilig auf die Monate."
	>
		<Field
			label="Zeitraum von"
			error={errors?.periodStart}
			note={periodDefaulted
				? 'Vorbelegt mit dem Vorjahr, für die Abrechnung des letzten Jahres.'
				: undefined}
		>
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
		</Field>
		<Field label="Zeitraum bis" error={errors?.periodEnd}>
			<input
				type="date"
				name="periodEnd"
				defaultValue={value('periodEnd', item?.periodEnd ?? prefill?.periodEnd ?? period.periodEnd)}
				aria-invalid={errors?.periodEnd ? 'true' : undefined}
				required
			/>
		</Field>
	</FormSection>

	{#if condominium}
		<FormSection
			title="Aus der Hausgeldabrechnung (WEG)"
			description="Die Gesamtkosten der WEG und der Schlüssel, mit dem der Verwalter sie verteilt hat. Als Betrag oben trägst du den Anteil der Wohnung laut Hausgeldabrechnung ein. Die Abrechnung an den Mieter zeigt dann alle drei Werte, damit er den Anteil nachrechnen kann."
		>
			<Field label="Gesamtkosten der WEG in €" error={errors?.associationTotal}>
				<input
					name="associationTotal"
					inputmode="decimal"
					defaultValue={value(
						'associationTotal',
						item?.associationTotal != null ? formatCentsPlain(item.associationTotal) : ''
					)}
					aria-invalid={errors?.associationTotal ? 'true' : undefined}
				/>
			</Field>
			<Field label="Schlüssel der WEG" error={errors?.associationKey}>
				<input
					name="associationKey"
					defaultValue={associationValue('associationKey')}
					placeholder="z. B. MEA, Wohnfläche, Einheiten"
					aria-invalid={errors?.associationKey ? 'true' : undefined}
				/>
			</Field>
			<Field
				label="Anteil der Wohnung"
				error={errors?.associationKeyShare}
				hint="Bei MEA die erste Zahl des Bruchs, z. B. 85. Vorbelegt aus dem Objekt."
			>
				<input
					name="associationKeyShare"
					inputmode="decimal"
					defaultValue={associationValue('associationKeyShare')}
					placeholder="z. B. 85"
					aria-invalid={errors?.associationKeyShare ? 'true' : undefined}
				/>
			</Field>
			<Field
				label="Summe des Schlüssels in der WEG"
				error={errors?.associationKeyTotal}
				hint="Bei MEA die zweite Zahl des Bruchs, z. B. 1000. Vorbelegt aus dem Objekt."
				note={associationHint ?? undefined}
			>
				<input
					name="associationKeyTotal"
					inputmode="decimal"
					defaultValue={associationValue('associationKeyTotal')}
					placeholder="z. B. 1000"
					aria-invalid={errors?.associationKeyTotal ? 'true' : undefined}
				/>
			</Field>
		</FormSection>
	{/if}

	<FormSection
		title="Brennstoffrechnung"
		description="Für die CO₂-Kostenaufteilung, nur bei der Rechnung des Energieversorgers einer Zentralheizung: kWh, CO₂-Menge und CO₂-Kosten, wie sie auf der Rechnung stehen. Bei Erdgas, Heizöl und Flüssiggas kannst du die CO₂-Menge leer lassen; sie wird aus den kWh berechnet."
	>
		<Field label="Brennstoff" error={errors?.fuel}>
			<select name="fuel" aria-invalid={errors?.fuel ? 'true' : undefined}>
				<option value="" selected={fuelChoice === ''}>keiner</option>
				{#each fuels as candidate (candidate)}
					<option value={candidate} selected={fuelChoice === candidate}
						>{fuelLabels[candidate]}</option
					>
				{/each}
			</select>
		</Field>
		<Field label="Energiemenge in kWh" error={errors?.fuelKwh}>
			<input
				name="fuelKwh"
				inputmode="decimal"
				defaultValue={value('fuelKwh', item?.fuelKwh?.toString() ?? '')}
				aria-invalid={errors?.fuelKwh ? 'true' : undefined}
			/>
		</Field>
		<Field label="CO₂-Menge in kg" error={errors?.co2Kg}>
			<input
				name="co2Kg"
				inputmode="decimal"
				defaultValue={value('co2Kg', item?.co2Kg?.toString() ?? '')}
				aria-invalid={errors?.co2Kg ? 'true' : undefined}
			/>
		</Field>
		<Field label="CO₂-Kosten in €" error={errors?.co2Cost} note={costHint ?? undefined}>
			<input
				name="co2Cost"
				inputmode="decimal"
				defaultValue={value('co2Cost', item?.co2Cost ? formatCentsPlain(item.co2Cost) : '')}
				aria-invalid={errors?.co2Cost ? 'true' : undefined}
			/>
		</Field>
	</FormSection>

	<FormSection title="Datei">
		<div class="form-wide">
			<Field label="Beleg als Datei (optional)" error={errors?.receipt} note="Höchstens 10 MB.">
				<input type="file" name="receipt" aria-invalid={errors?.receipt ? 'true' : undefined} />
			</Field>
		</div>
	</FormSection>

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
</style>
