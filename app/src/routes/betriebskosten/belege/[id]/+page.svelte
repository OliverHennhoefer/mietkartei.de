<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate } from '$app/navigation';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import CostItemForm from '#lib/components/CostItemForm.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { unitAmountsSummary } from '#lib/domain/operating-costs.ts';
	import { allocationKeyKindLabels } from '#lib/labels.ts';
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

	const amountOf = (unitId: string) =>
		data.unitAmounts.find((entry) => entry.unitId === unitId)?.amount;
	const amountValue = (unitId: string) => {
		const typed =
			amountsForm && 'amountValues' in amountsForm ? amountsForm.amountValues : undefined;
		if (typed) return typed[`amount-${unitId}`] ?? '';
		const amount = amountOf(unitId);
		return amount === undefined ? '' : formatCentsPlain(amount);
	};
	const amountError = (unitId: string) =>
		amountsForm && 'amountErrors' in amountsForm
			? (amountsForm.amountErrors as Record<string, string | undefined>)[`amount-${unitId}`]
			: undefined;
	const summary = $derived(
		unitAmountsSummary(
			data.unitAmounts.map((entry) => entry.amount),
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
				<label>
					{unit.name} in €
					<input
						name="amount-{unit.id}"
						inputmode="decimal"
						defaultValue={amountValue(unit.id)}
						aria-invalid={amountError(unit.id) ? 'true' : undefined}
					/>
					{#if amountError(unit.id)}<span class="error">{amountError(unit.id)}</span>{/if}
				</label>
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
