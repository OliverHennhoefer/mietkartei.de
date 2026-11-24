<script lang="ts">
	import { page } from '$app/state';
	import Badge from '#lib/components/Badge.svelte';
	import FormDialog from '#lib/components/FormDialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import Sections from '../Sections.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatNumber } from '#lib/format.ts';
	import { expenseCategoryLabels } from '#lib/labels.ts';
	import { formatCents, formatCentsPlain } from '#lib/money.ts';
	import { byDate, byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refused edit belongs to the edit dialog, everything else to the form below the table.
	const editRefused = $derived(form && 'edit' in form);
	const errors = $derived(
		form && 'errors' in form && !editRefused ? (form.errors as Record<string, string>) : undefined
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form && !editRefused ? (form.values as Record<string, string>) : {}
	);
	const editErrors = $derived(
		form && 'errors' in form && editRefused ? (form.errors as Record<string, string>) : undefined
	);
	// After a refused save the typed values win; otherwise the dialog shows the expense as stored.
	const editValues = $derived<Record<string, string>>(
		form && 'values' in form && editRefused
			? (form.values as Record<string, string>)
			: data.editing
				? {
						date: data.editing.date,
						description: data.editing.description,
						amount: formatCentsPlain(data.editing.amount),
						category: data.editing.category,
						scope: data.editing.scope,
						serviceProviderId: data.editing.serviceProviderId ?? ''
					}
				: {}
	);
	const total = $derived(data.expenses.reduce((sum, expense) => sum + expense.amount, 0));
	const sort = new TableSort<PageProps['data']['expenses'][number]>({
		date: byDate((expense) => expense.date),
		description: byText((expense) => expense.description),
		category: byText((expense) => expenseCategoryLabels[expense.category]),
		scope: byText((expense) => expense.scopeLabel),
		serviceProvider: byText((expense) => expense.serviceProviderName ?? ''),
		amount: byNumber((expense) => expense.amount)
	});

	/** The share of the year's sum in whole percent, "< 1 %" for a small one. */
	function share(amount: number): string {
		if (total <= 0) return '–';
		const percent = (amount / total) * 100;
		return percent > 0 && percent < 0.5 ? '< 1 %' : `${formatNumber(percent, 0)} %`;
	}

	// ?neu opens the create dialog; it stays open while the server refuses the input.
	const creating = $derived(page.url.searchParams.has('neu') && !(form && 'created' in form));
	// The year of the expense the dialog created, confirmed above the list once it has closed.
	let createdYear = $state<number>();
	$effect(() => {
		if (creating) createdYear = undefined;
	});
	const createdShown = $derived(
		creating ? undefined : (createdYear ?? (form && 'created' in form ? form.year : undefined))
	);

	/**
	 * A description used before brings its category, scope and Dienstleister along, as long as no
	 * category is chosen yet: the same payee is usually booked the same way.
	 */
	function descriptionPicked(event: Event & { currentTarget: HTMLInputElement }) {
		const suggestion = data.suggestions.find(
			(candidate) => candidate.description === event.currentTarget.value
		);
		const createForm = event.currentTarget.form;
		const category = createForm?.elements.namedItem('category');
		if (!createForm || !suggestion || !(category instanceof HTMLSelectElement) || category.value)
			return;
		category.value = suggestion.category;
		pick(createForm, 'scope', suggestion.scope);
		pick(createForm, 'serviceProviderId', suggestion.serviceProviderId);
	}

	/** Selects the value in the create form's select of that name, when it offers it. */
	function pick(createForm: HTMLFormElement, name: string, value: string) {
		const select = createForm.elements.namedItem(name);
		if (
			select instanceof HTMLSelectElement &&
			[...select.options].some((option) => option.value === value)
		) {
			select.value = value;
		}
	}
</script>

<PageHeader title="Ausgaben">
	{#snippet actions()}
		<CreateButton
			href="?jahr={data.year}&neu"
			label="Ausgabe erfassen"
			data-sveltekit-reset={false}
		/>
	{/snippet}
</PageHeader>

<Sections />

<div class="toolbar">
	<form method="GET" class="row">
		<label class="inline">
			Jahr
			<select name="jahr" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				{#each data.years as year (year)}
					<option value={String(year)} selected={data.year === year}>{year}</option>
				{/each}
			</select>
		</label>
		<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
	</form>
	<strong>Summe {data.year}: <Money cents={total} /></strong>
	<a href="/bank">Ausgehende Umsätze zuordnen</a>
</div>

{#if form && 'message' in form}
	<p class="error" role="alert">{form.message}</p>
{/if}
{#if createdShown}
	<p role="status">
		Die Ausgabe wurde erfasst.{#if createdShown !== data.year}
			<a href="?jahr={createdShown}">Ausgaben {createdShown} anzeigen</a>{/if}
	</p>
{/if}

<h2>Ausgaben {data.year}</h2>
{#if data.expenses.length === 0}
	<p class="muted">
		Keine Ausgaben in {data.year}. Ausgehende Bankumsätze buchst du unter <a href="/bank">Bank</a>
		als Ausgabe; was du bar oder von einem anderen Konto bezahlt hast, erfasst du mit „Ausgabe erfassen“.
	</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Ausgaben {data.year}">
			<thead>
				<tr>
					<SortHeader {sort} key="date">Datum</SortHeader>
					<SortHeader {sort} key="description">Beschreibung</SortHeader>
					<SortHeader {sort} key="category">Kategorie</SortHeader>
					<SortHeader {sort} key="scope">Betrifft</SortHeader>
					<SortHeader {sort} key="serviceProvider">Dienstleister</SortHeader>
					<SortHeader {sort} key="amount" class="num">Betrag</SortHeader>
					<th><span class="visually-hidden">Aktion</span></th>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.expenses) as expense (expense.id)}
					<tr>
						<td class="date">{formatDate(expense.date)}</td>
						<td>
							{#if expense.bankTransactionId}
								{expense.description}
							{:else}
								<a href="?jahr={data.year}&bearbeiten={expense.id}" data-sveltekit-reset="false"
									>{expense.description}</a
								>
							{/if}
						</td>
						<td>{expenseCategoryLabels[expense.category]}</td>
						<td class="muted">{expense.scopeLabel}</td>
						<td class:muted={!expense.serviceProviderName}>
							{expense.serviceProviderName ?? 'Unbekannt'}
						</td>
						<td class="number"><Money cents={expense.amount} /></td>
						<td class="action">
							{#if expense.bankTransactionId}
								<a href="/bank?umsatz={expense.bankTransactionId}"><Badge>aus Bank</Badge></a>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if data.expenses.length > 0}
	<h2>Nach Dienstleister</h2>
	<div class="table-wrap">
		<table class="table" aria-label="Ausgaben {data.year} nach Dienstleister">
			<thead>
				<tr>
					<th>Dienstleister</th>
					<th class="num">Ausgaben</th>
					<th class="num">Summe</th>
					<th class="num">Anteil</th>
				</tr>
			</thead>
			<tbody>
				{#each data.byServiceProvider as group (group.id)}
					<tr>
						<td>
							{#if group.id}
								<a href="/dienstleister?bearbeiten={group.id}">{group.name}</a>
							{:else}
								<span class="muted">{group.name}</span>
							{/if}
						</td>
						<td class="number">{group.count}</td>
						<td class="number"><Money cents={group.total} /></td>
						<td class="number">{share(group.total)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if creating}
	<FormDialog
		title="Ausgabe erfassen"
		action="?/create"
		submitLabel="Ausgabe erfassen"
		close="/auswertung/ausgaben?jahr={data.year}"
		onsaved={(saved) => (createdYear = Number(saved?.year))}
	>
		{@render expenseFields(values, errors, true)}
		<datalist id="expense-descriptions">
			{#each data.suggestions as suggestion (suggestion.description)}
				<option value={suggestion.description}></option>
			{/each}
		</datalist>
	</FormDialog>
{/if}

{#snippet expenseFields(
	values: Record<string, string>,
	errors: Record<string, string> | undefined,
	create: boolean
)}
	<div class="fields">
		<Field label="Datum" error={errors?.date}>
			<input
				type="date"
				name="date"
				defaultValue={values.date ?? (create ? data.today : '')}
				aria-invalid={errors?.date ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Beschreibung" error={errors?.description}>
			<input
				name="description"
				maxlength="200"
				placeholder="z. B. Heizungswartung"
				defaultValue={values.description ?? ''}
				list={data.suggestions.length ? 'expense-descriptions' : undefined}
				autocomplete="off"
				onchange={create ? descriptionPicked : undefined}
				aria-invalid={errors?.description ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Betrag" error={errors?.amount}>
			<input
				name="amount"
				inputmode="decimal"
				placeholder="0"
				defaultValue={values.amount ?? ''}
				aria-invalid={errors?.amount ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Kategorie" error={errors?.category}>
			<select name="category" aria-invalid={errors?.category ? 'true' : undefined} required>
				<option value="" selected={!values.category}>– bitte wählen –</option>
				{#each Object.entries(expenseCategoryLabels) as [value, label] (value)}
					<option {value} selected={values.category === value}>{label}</option>
				{/each}
			</select>
		</Field>
		<Field label="Betrifft" error={errors?.scope}>
			<select name="scope" aria-invalid={errors?.scope ? 'true' : undefined}>
				<option value="" selected={!values.scope}>Gesamter Bestand</option>
				{#each data.scopes as group (group.id)}
					<optgroup label={group.label}>
						{#each group.options as option (option.value)}
							<option value={option.value} selected={values.scope === option.value}>
								{option.label}
							</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</Field>
		<Field
			label="Dienstleister"
			error={errors?.serviceProviderId}
			hint={data.serviceProviders.length === 0
				? 'Angelegt werden Dienstleister unter Bestand → Dienstleister.'
				: undefined}
		>
			<select
				name="serviceProviderId"
				aria-invalid={errors?.serviceProviderId ? 'true' : undefined}
			>
				<option value="" selected={!values.serviceProviderId}>Unbekannt</option>
				{#each data.serviceProviders as provider (provider.id)}
					<option value={provider.id} selected={values.serviceProviderId === provider.id}>
						{provider.name}
					</option>
				{/each}
			</select>
		</Field>
	</div>
{/snippet}

{#if data.editing}
	{#key data.editing.id}
		<FormDialog
			title="Ausgabe bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage="Ausgabe „{data.editing.description}“ über {formatCents(
				data.editing.amount
			)} wirklich löschen?"
			close="/auswertung/ausgaben?jahr={data.year}"
			error={form && 'message' in form ? form.message : undefined}
		>
			<input type="hidden" name="id" value={data.editing.id} />
			{@render expenseFields(editValues, editErrors, false)}
		</FormDialog>
	{/key}
{/if}

<style>
	.fields {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
	}
	.date,
	.number {
		white-space: nowrap;
	}
	.number {
		text-align: right;
	}
	.action {
		text-align: right;
	}
	.action a {
		text-decoration: none;
	}
</style>
