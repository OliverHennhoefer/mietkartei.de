<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { behgHint, co2KgFromKwh, residentialTiers } from '#lib/domain/co2.ts';
	import { formatArea, formatNumber, parseDecimal } from '#lib/format.ts';
	import { fuelLabels } from '#lib/labels.ts';
	import { formatCents } from '#lib/money.ts';
	import type { Fuel } from '#lib/server/db/schema.ts';
	import type { PageProps } from './$types';

	// The CO₂ tab: the heading and tab bar come from the lease layout. The tenant bought the fuel
	// (§ 6 CO2KostAufG), so the split is entered here and the landlord's share credited.
	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const hint = $derived(form && 'hint' in form ? form.hint : null);

	/** The fuels in the order of the schema enum; the schema itself is server-only. */
	const fuels = Object.keys(fuelLabels) as Fuel[];

	/** The dwelling: the main unit plus the extra units rented with it. */
	const dwellingArea = $derived(
		[data.lease.unit, ...data.lease.extraUnits].reduce(
			(sum, unit) => sum + (unit.floorArea ?? 0),
			0
		)
	);

	/** `72.5` → `72,5`, as the form field expects it. */
	const areaInput = $derived(dwellingArea > 0 ? String(dwellingArea).replace('.', ',') : '');

	/** The fields the BEHG hint reads, as typed; null until the user types after a submit. */
	let typed = $state<Record<string, string> | null>(null);
	$effect(() => {
		void form;
		typed = null;
	});
	const field = (name: string, fallback: string) => typed?.[name] ?? values?.[name] ?? fallback;

	/** The cost the emissions of the year have at the BEHG price, under the CO₂ cost field. */
	const costHint = $derived.by(() => {
		const fuel = field('fuel', 'gas');
		const kg =
			parseDecimal(field('co2Kg', '')) ?? co2KgFromKwh(fuel, parseDecimal(field('fuelKwh', '')));
		const year = Number(field('year', String(data.defaults.year)));
		const behg = kg === null ? null : behgHint(year, kg);
		return behg ? `Wie auf der Rechnung angegeben. ${behg}` : 'Wie auf der Rechnung angegeben.';
	});

	function readFields(element: HTMLFormElement) {
		const entries = new FormData(element);
		typed = Object.fromEntries(
			['year', 'fuel', 'fuelKwh', 'co2Kg'].map((name) => [name, String(entries.get(name) ?? '')])
		);
	}

	/** Anlage 1 names ten tiers; a non-residential building is split half and half (§ 8). */
	function tierLabel(landlordPercent: number): string {
		if (data.lease.property.buildingUse === 'non_residential') return 'Nichtwohngebäude';
		const index = residentialTiers.findIndex(([, percent]) => percent === landlordPercent);
		return index < 0 ? '–' : `Stufe ${index + 1}`;
	}
</script>

<h2>CO₂-Kostenaufteilung</h2>
<p>
	Diese Seite ist für Mietverträge, bei denen der Mieter den Brennstoff selbst einkauft, etwa bei
	einer Gasetagenheizung (§ 6 CO2KostAufG). Der Mieter legt dir die Rechnung seines Versorgers vor,
	auf der die CO₂-Menge und die CO₂-Kosten des Jahres stehen. Aus den Emissionen je Quadratmeter
	Wohnfläche ergibt sich dein Anteil, der als Gutschrift auf das Mietkonto gebucht wird und
	innerhalb von zwölf Monaten nach der Geltendmachung zu erstatten ist.
</p>

<div class="toolbar">
	<a class="button secondary" href="/vertraege/{data.lease.id}/mietkonto">Zum Mietkonto</a>
</div>

{#if form?.created}
	<Alert tone="success">
		<p>
			Die CO₂-Kostenaufteilung {form.created.year} ist gebucht: Gutschrift über
			{formatCents(form.created.amount)} auf dem Mietkonto.
		</p>
	</Alert>
{/if}
{#if hint}
	<Alert tone="info"><p>{hint}</p></Alert>
{/if}

<form
	method="POST"
	action="?/create"
	class="card"
	use:enhance
	oninput={(event) => readFields(event.currentTarget)}
>
	<Field label="Jahr" error={errors?.year}>
		<input
			name="year"
			type="number"
			inputmode="numeric"
			defaultValue={values?.year ?? String(data.defaults.year)}
			aria-invalid={errors?.year ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Brennstoff" error={errors?.fuel}>
		<select name="fuel" aria-invalid={errors?.fuel ? 'true' : undefined} required>
			{#each fuels as fuel (fuel)}
				<option value={fuel} selected={(values?.fuel ?? 'gas') === fuel}>{fuelLabels[fuel]}</option>
			{/each}
		</select>
	</Field>
	<Field
		label="Verbrauch in kWh (optional)"
		error={errors?.fuelKwh}
		hint="Bei Erdgas, Heizöl und Flüssiggas wird daraus die CO₂-Menge vorgeschlagen."
	>
		<input
			name="fuelKwh"
			inputmode="decimal"
			defaultValue={values?.fuelKwh ?? ''}
			aria-invalid={errors?.fuelKwh ? 'true' : undefined}
		/>
	</Field>
	<Field label="CO₂-Menge in kg" error={errors?.co2Kg} hint="Wie auf der Rechnung angegeben.">
		<!-- `value`, not `defaultValue`: the prefilled kg must replace the empty field. -->
		<input
			name="co2Kg"
			inputmode="decimal"
			value={values?.co2Kg ?? ''}
			aria-invalid={errors?.co2Kg ? 'true' : undefined}
		/>
	</Field>
	<Field label="CO₂-Kosten in €" error={errors?.co2Cost} hint={costHint}>
		<input
			name="co2Cost"
			inputmode="decimal"
			defaultValue={values?.co2Cost ?? ''}
			aria-invalid={errors?.co2Cost ? 'true' : undefined}
			required
		/>
	</Field>
	<Field
		label="Wohnfläche in m²"
		error={errors?.area}
		hint="Vorbelegt mit der Fläche der Einheit und der mitvermieteten Einheiten."
	>
		<input
			name="area"
			inputmode="decimal"
			defaultValue={values?.area ?? areaInput}
			aria-invalid={errors?.area ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Rechnungsdatum (optional)" error={errors?.invoiceDate}>
		<input
			name="invoiceDate"
			type="date"
			defaultValue={values?.invoiceDate ?? ''}
			aria-invalid={errors?.invoiceDate ? 'true' : undefined}
		/>
	</Field>
	<Field label="Geltend gemacht am" error={errors?.claimedOn}>
		<input
			name="claimedOn"
			type="date"
			defaultValue={values?.claimedOn ?? data.defaults.claimedOn}
			aria-invalid={errors?.claimedOn ? 'true' : undefined}
			required
		/>
	</Field>
	<div class="form-actions">
		<button type="submit">CO₂-Kosten aufteilen</button>
	</div>
</form>

<h2>Aufteilungen</h2>
{#if data.splits.length === 0}
	<EmptyState
		title="Noch keine CO₂-Kostenaufteilung"
		text="Trage oben die Angaben aus der Rechnung ein, die der Mieter dir vorgelegt hat."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="CO₂-Kostenaufteilungen">
			<thead>
				<tr>
					<th>Jahr</th>
					<th>Brennstoff</th>
					<th class="num">CO₂</th>
					<th class="num">je m²</th>
					<th>Stufe</th>
					<th class="num">Vermieteranteil</th>
					<th class="num">Gutschrift</th>
					<th>Geltend gemacht</th>
					<th>Frist</th>
					<th class="actions"><span class="visually-hidden">Aktionen</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.splits as split (split.id)}
					<tr>
						<td>{split.year}</td>
						<td>{fuelLabels[split.fuel]}</td>
						<td class="num">{formatNumber(split.co2Kg, 1)} kg</td>
						<td class="num">{formatNumber(split.kgPerSquareMetre, 1)} kg/m²</td>
						<td
							>{tierLabel(split.landlordPercent)}
							<span class="muted">({formatArea(split.area)})</span></td
						>
						<td class="num">{split.landlordPercent} %</td>
						<td class="num"><Money cents={split.amount} /></td>
						<td>{formatDate(split.claimedOn)}</td>
						<td>
							{formatDate(split.deadline)}
							{#if split.deadlinePassed}<Badge tone="danger">Frist abgelaufen</Badge>{/if}
						</td>
						<td class="actions">
							<ConfirmButton
								action="?/delete"
								label="Löschen"
								message={`CO₂-Kostenaufteilung ${split.year} und die Gutschrift über ${formatCents(split.amount)} löschen?`}
							>
								<input type="hidden" name="splitId" value={split.id} />
							</ConfirmButton>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
