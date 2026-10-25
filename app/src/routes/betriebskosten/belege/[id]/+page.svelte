<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate } from '$app/navigation';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import CostItemForm from '#lib/components/CostItemForm.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { unitAmountsSummary } from '#lib/domain/operating-costs.ts';
	import { formatNumber } from '#lib/format.ts';
	import { allocationKeyKindLabels, fuelLabels } from '#lib/labels.ts';
	import { formatCentsPlain } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Saving redirects back here, which keeps the page and the chosen receipt file; a new form
	// for every navigation shows the saved item and does not upload the file twice.
	let visit = $state(0);
	afterNavigate(({ type }) => {
		if (type !== 'enter') visit += 1;
	});

	const itemForm = $derived(form?.form === 'item' ? form : undefined);
	const amountsForm = $derived(form?.form === 'amounts' ? form : undefined);
	const uploadForm = $derived(form?.form === 'upload' ? form : undefined);
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);

	/** The input of a unit's own amount, or with a lease of the amount of that lease in it. */
	const fieldName = (unitId: string, leaseId: string | null = null) =>
		leaseId ? `amount-${unitId}-${leaseId}` : `amount-${unitId}`;
	const amountOf = (unitId: string, leaseId: string | null = null) =>
		data.unitAmounts.find((entry) => entry.unitId === unitId && entry.leaseId === leaseId)?.amount;
	const amountValue = (unitId: string, leaseId: string | null = null) => {
		const typed =
			amountsForm && 'amountValues' in amountsForm ? amountsForm.amountValues : undefined;
		if (typed) return typed[fieldName(unitId, leaseId)] ?? '';
		const amount = amountOf(unitId, leaseId);
		return amount === undefined ? '' : formatCentsPlain(amount);
	};
	const amountError = (unitId: string, leaseId: string | null = null) =>
		amountsForm && 'amountErrors' in amountsForm
			? (amountsForm.amountErrors as Record<string, string | undefined>)[fieldName(unitId, leaseId)]
			: undefined;
	// Only the units and leases the form shows: other rows go with the next save.
	const summary = $derived(
		unitAmountsSummary(
			data.units
				.flatMap((unit) => [
					amountOf(unit.id) ?? [],
					...unit.leases.map((lease) => amountOf(unit.id, lease.id) ?? [])
				])
				.flat(),
			data.item.amount
		)
	);
</script>

<div class="toolbar">
	<a href="/betriebskosten/belege?property={data.item.propertyId}">← Alle Belege</a>
</div>

<h2>{data.item.description}</h2>

<dl class="details">
	<dt>Objekt</dt>
	<dd>{data.item.propertyName}</dd>
	<dt>Kostenart</dt>
	<dd>{data.item.categoryName}</dd>
	<dt>Umlageschlüssel</dt>
	<dd>{data.item.keyName} ({allocationKeyKindLabels[data.item.keyKind]})</dd>
	<dt>Abrechnungskreis</dt>
	<dd>{data.item.circleName ?? 'alle Einheiten des Objekts'}</dd>
	<dt>Zeitraum</dt>
	<dd>{formatDate(data.item.periodStart)} – {formatDate(data.item.periodEnd)}</dd>
	<dt>Betrag</dt>
	<dd><Money cents={data.item.amount} /> {data.item.allocable ? '' : '(nicht umlagefähig)'}</dd>
	{#if data.item.associationTotal !== null}
		<dt>WEG</dt>
		<dd>
			Gesamt <Money cents={data.item.associationTotal} /> · {data.item.associationKey}
			{formatNumber(data.item.associationKeyShare ?? 0)} von {formatNumber(
				data.item.associationKeyTotal ?? 0
			)}
		</dd>
	{/if}
	{#if data.item.fuel}
		<dt>Brennstoff</dt>
		<dd>
			{fuelLabels[data.item.fuel]}{#if data.item.fuelKwh !== null}, {formatNumber(
					data.item.fuelKwh
				)} kWh{/if}{#if data.item.co2Kg !== null}, {formatNumber(data.item.co2Kg)} kg CO₂{/if}{#if data.item.co2Cost !== null},
				CO₂-Kosten <Money cents={data.item.co2Cost} />{/if}
		</dd>
	{/if}
</dl>

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{/if}

<h2>Beleg bearbeiten</h2>
{#key visit}
	<CostItemForm
		action="?/update"
		properties={data.properties}
		categories={data.categories}
		keys={data.keys}
		circles={data.circles}
		item={data.item}
		history={data.history}
		errors={itemForm && 'errors' in itemForm ? itemForm.errors : undefined}
		values={itemForm && 'values' in itemForm ? itemForm.values : undefined}
	/>
{/key}

{#if data.item.keyKind === 'direct'}
	<h2>Beträge je Einheit</h2>
	<p class="muted">
		Der Anteil jeder Einheit, z. B. aus der Abrechnung des Messdienstleisters. Summe der Beträge:
		<Money cents={summary.sum} /> von <Money
			cents={data.item.amount}
		/>{#if summary.difference !== 0}, Differenz
			<Money cents={summary.difference} />{/if}.
	</p>
	{#if amountsForm && 'saved' in amountsForm}
		<Alert tone="success"><p>Die Beträge wurden gespeichert.</p></Alert>
	{/if}
	{#if data.units.length === 0}
		<p>Das Objekt hat noch keine Einheiten.</p>
	{:else}
		<form method="POST" action="?/amounts" class="card" use:enhance>
			{#each data.units as unit (unit.id)}
				{#if unit.leases.length === 0}
					<label>
						{unit.name} in €
						<input
							name={fieldName(unit.id)}
							inputmode="decimal"
							defaultValue={amountValue(unit.id)}
							aria-invalid={amountError(unit.id) ? 'true' : undefined}
						/>
						{#if amountError(unit.id)}<span class="error">{amountError(unit.id)}</span>{/if}
					</label>
				{:else}
					<fieldset>
						<legend>{unit.name}</legend>
						<p class="muted">
							Die Einheit hat im Zeitraum den Mieter gewechselt oder stand leer. Trage die Beträge
							je Mietvertrag aus der Abrechnung des Messdienstleisters ein; was auf den Leerstand
							entfällt, bleibt bei dir. Ohne Zwischenablesung trägst du nur den Betrag der Einheit
							ein, er wird nach Tagen aufgeteilt.
						</p>
						{#each unit.leases as lease (lease.id)}
							<label>
								{lease.tenants || 'Mietvertrag'} ({formatDate(lease.start)} – {formatDate(
									lease.end
								)}) in €
								<input
									name={fieldName(unit.id, lease.id)}
									inputmode="decimal"
									defaultValue={amountValue(unit.id, lease.id)}
									aria-invalid={amountError(unit.id, lease.id) ? 'true' : undefined}
								/>
								{#if amountError(unit.id, lease.id)}
									<span class="error">{amountError(unit.id, lease.id)}</span>
								{/if}
							</label>
						{/each}
						<label>
							Oder ganze Einheit in €
							<input
								name={fieldName(unit.id)}
								inputmode="decimal"
								defaultValue={amountValue(unit.id)}
								aria-invalid={amountError(unit.id) ? 'true' : undefined}
							/>
							{#if amountError(unit.id)}<span class="error">{amountError(unit.id)}</span>{/if}
						</label>
					</fieldset>
				{/if}
			{/each}
			<div class="form-actions">
				<button type="submit">Beträge speichern</button>
			</div>
		</form>
	{/if}
{/if}

<h2>Belegdatei</h2>
{#if data.receiptError}
	<Alert tone="danger">
		<p>Der Beleg ist gespeichert, die Datei aber nicht: {data.receiptError}</p>
	</Alert>
{/if}
{#if data.item.receipts.length === 0}
	<form method="POST" action="?/upload" class="card" enctype="multipart/form-data" use:enhance>
		<label>
			Datei (höchstens 10 MB)
			<input
				type="file"
				name="receipt"
				aria-invalid={uploadForm?.errors.receipt ? 'true' : undefined}
				required
			/>
			{#if uploadForm?.errors.receipt}<span class="error">{uploadForm.errors.receipt}</span>{/if}
		</label>
		<div class="form-actions">
			<button type="submit">Datei hochladen</button>
		</div>
	</form>
{:else}
	<ul class="list" aria-label="Belegdateien">
		{#each data.item.receipts as receipt (receipt.id)}
			<li class="card">
				<a href="/dokumente/{receipt.id}/herunterladen">{receipt.name}</a>
				<ConfirmButton
					action="?/deleteReceipt"
					label="Datei löschen"
					message="Datei „{receipt.name}“ wirklich löschen?"
					tone="secondary"
				>
					<input type="hidden" name="documentId" value={receipt.id} />
				</ConfirmButton>
			</li>
		{/each}
	</ul>
{/if}

<h2>Beleg löschen</h2>
<p class="muted">Die Belegdatei und die Beträge je Einheit werden mit gelöscht.</p>
<ConfirmButton
	action="?/delete"
	label="Beleg löschen"
	message="Beleg „{data.item.description}“ wirklich löschen?"
/>

<style>
	fieldset {
		display: grid;
		gap: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 0.75rem 1rem 1rem;
		margin: 0;
	}
	legend {
		font-weight: 500;
		font-size: 0.9rem;
		padding: 0 0.25rem;
	}
	fieldset p {
		margin: 0;
	}
</style>
