<script lang="ts">
	import { enhance } from '$app/forms';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import {
		contraAccountKindLabels,
		contraAccountKindShortLabels,
		expenseCategoryLabels
	} from '#lib/labels.ts';
	import { byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refused edit belongs to the edit dialog, everything else to the create form.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived(form && 'errors' in form && !editRefused ? form.errors : undefined);
	const values = $derived(form && 'values' in form && !editRefused ? form.values : undefined);
	const editValues = $derived(
		editRefused?.values ??
			(data.editing && {
				number: data.editing.number ?? '',
				name: data.editing.name,
				kind: data.editing.kind,
				expenseCategory: data.editing.expenseCategory ?? '',
				propertyId: data.editing.propertyId ?? ''
			})
	);
	const propertyNames = $derived(
		new Map(data.properties.map((property) => [property.id, property.name]))
	);
	const kinds = Object.entries(contraAccountKindLabels);
	const categories = Object.entries(expenseCategoryLabels);

	type Row = PageProps['data']['contraAccounts'][number];
	const sort = new TableSort<Row>({
		number: byText((row) => row.number ?? ''),
		name: byText((row) => row.name),
		kind: byText((row) => contraAccountKindShortLabels[row.kind]),
		property: byText((row) => (row.propertyId ? (propertyNames.get(row.propertyId) ?? '') : '')),
		total: byNumber((row) => data.totals[row.id]?.amount ?? 0),
		count: byNumber((row) => data.totals[row.id]?.count ?? 0)
	});

	/** What the account books beyond its kind: the expense category. */
	function detail(row: Row): string {
		return row.kind === 'expense' && row.expenseCategory
			? `${contraAccountKindShortLabels[row.kind]} · ${expenseCategoryLabels[row.expenseCategory]}`
			: contraAccountKindShortLabels[row.kind];
	}
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Gegenkonten" tab. -->
<h2 class="visually-hidden">Gegenkonten</h2>
<p class="muted">
	Gegenkonten sind die Konten deiner Buchhaltung, auf die ein Umsatz gebucht wird, etwa „4401
	Grundsteuer“ oder „8005 Mieten Rudolf“. Die Art legt fest, was die Buchung in Mietkartei bewirkt.
	Mieten bucht Mietkartei selbst auf die Gegenkonten des Objekts: Kaltmiete und
	Nebenkosten-Vorauszahlungen getrennt, eine Nachzahlung aus der Abrechnung auf Nebenkosten Vorjahr.
	Konten ohne Objekt gelten für alle Objekte ohne eigenes Konto dieser Art.
</p>

{#if data.contraAccounts.length > 0}
	<div class="toolbar">
		<nav class="row" aria-label="Jahr">
			{#each data.years as year (year)}
				<a
					href="?jahr={year}"
					class="button small {data.year === year ? '' : 'secondary'}"
					aria-current={data.year === year ? 'page' : undefined}
				>
					{year}
				</a>
			{/each}
		</nav>
		<a class="button secondary small" href="/bank/datev?von={data.year}-01-01&bis={data.year}-12-31"
			>DATEV-Export {data.year}</a
		>
	</div>
{/if}

{#if data.contraAccounts.length === 0}
	<EmptyState
		title="Noch keine Gegenkonten"
		text="Lege die Konten aus deiner Buchhaltung an, dann kannst du Umsätze darauf buchen und als DATEV-Buchungsstapel ausgeben."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Gegenkonten">
			<thead>
				<tr>
					<SortHeader {sort} key="number">Nummer</SortHeader>
					<SortHeader {sort} key="name">Name</SortHeader>
					<SortHeader {sort} key="kind">Art</SortHeader>
					<SortHeader {sort} key="property">Objekt</SortHeader>
					<SortHeader {sort} key="total" class="num">Summe {data.year}</SortHeader>
					<SortHeader {sort} key="count" class="num">Buchungen</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.contraAccounts) as row (row.id)}
					<tr>
						<td class="number">{row.number ?? '–'}</td>
						<td>
							<a href="?bearbeiten={row.id}" data-sveltekit-reset="false">{row.name}</a>
						</td>
						<td>{detail(row)}</td>
						<td>{row.propertyId ? (propertyNames.get(row.propertyId) ?? '–') : 'alle'}</td>
						<td class="num"><Money cents={data.totals[row.id]?.amount ?? 0} signed /></td>
						<td class="num">{data.totals[row.id]?.count ?? 0}</td>
					</tr>
				{/each}
			</tbody>
			{#if data.totals.none}
				<tfoot>
					<tr>
						<td></td>
						<td colspan="3">
							Ohne Gegenkonto gebucht
							<span class="muted small">(fehlt im DATEV-Export)</span>
						</td>
						<td class="num"><Money cents={data.totals.none.amount} signed /></td>
						<td class="num">{data.totals.none.count}</td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
{/if}

<h2 id="gegenkonto-anlegen">Gegenkonto anlegen</h2>
<form method="POST" action="?/create" class="card" use:enhance>
	{@render fields(values, errors)}
	<div class="form-actions form-wide">
		<button type="submit">Gegenkonto anlegen</button>
	</div>
	{#if form && 'created' in form}
		<p class="form-actions form-wide" role="status">Das Gegenkonto wurde angelegt.</p>
	{/if}
</form>

{#snippet fields(
	values: Record<string, string> | undefined | null,
	errors: Partial<Record<string, string>> | undefined
)}
	<Field
		label="Nummer"
		error={errors?.number}
		hint="Die Kontonummer in deiner Buchhaltung, optional."
	>
		<input
			name="number"
			inputmode="numeric"
			maxlength="20"
			defaultValue={values?.number ?? ''}
			placeholder="z. B. 4401"
			aria-invalid={errors?.number ? 'true' : undefined}
		/>
	</Field>
	<Field label="Name" error={errors?.name}>
		<input
			name="name"
			maxlength="100"
			defaultValue={values?.name ?? ''}
			placeholder="z. B. Grundsteuer"
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Art" error={errors?.kind}>
		<select name="kind" aria-invalid={errors?.kind ? 'true' : undefined} required>
			{#each kinds as [value, label] (value)}
				<option {value} selected={(values?.kind ?? 'expense') === value}>{label}</option>
			{/each}
		</select>
	</Field>
	<Field
		label="Kategorie der Ausgaben"
		error={errors?.expenseCategory}
		hint="Nur für die Art Ausgabe: so zählt die Buchung in der Auswertung und der Anlage V."
	>
		<select name="expenseCategory" aria-invalid={errors?.expenseCategory ? 'true' : undefined}>
			<option value="" selected={!values?.expenseCategory}>– keine –</option>
			{#each categories as [value, label] (value)}
				<option {value} selected={values?.expenseCategory === value}>{label}</option>
			{/each}
		</select>
	</Field>
	<Field label="Objekt" error={errors?.propertyId}>
		<select name="propertyId" aria-invalid={errors?.propertyId ? 'true' : undefined}>
			<option value="" selected={!values?.propertyId}>alle Objekte</option>
			{#each data.properties as property (property.id)}
				<option value={property.id} selected={values?.propertyId === property.id}>
					{property.name}
				</option>
			{/each}
		</select>
	</Field>
{/snippet}

{#if data.editing && editValues}
	{#key data.editing.id}
		<EditDialog
			title="Gegenkonto bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage="Gegenkonto „{data.editing.number
				? `${data.editing.number} ${data.editing.name}`
				: data.editing
						.name}“ löschen? Was darauf gebucht ist, bleibt gebucht, nur ohne Gegenkonto. Regeln auf dieses Konto werden gelöscht."
			close="/bank/gegenkonten"
		>
			<input type="hidden" name="id" value={data.editing.id} />
			{@render fields(editValues, editRefused?.errors)}
		</EditDialog>
	{/key}
{/if}

<style>
	.number {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
