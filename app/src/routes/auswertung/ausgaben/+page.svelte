<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { expenseCategoryLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(
		form && 'errors' in form ? (form.errors as Record<string, string>) : undefined
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form ? (form.values as Record<string, string>) : {}
	);
	const total = $derived(data.expenses.reduce((sum, expense) => sum + expense.amount, 0));
	const years = $derived(
		Array.from({ length: 6 }, (_, index) => data.currentYear - index).filter((year) => year >= 1900)
	);
</script>

<div class="toolbar">
	<form method="GET" class="row">
		<label class="inline">
			Jahr
			<select name="jahr" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				{#each years.includes(data.year) ? years : [data.year, ...years] as year (year)}
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

<h2>Ausgaben {data.year}</h2>
{#if data.expenses.length === 0}
	<p class="muted">
		Keine Ausgaben in {data.year}. Ausgehende Bankumsätze buchst du unter <a href="/bank">Bank</a>
		als Ausgabe; was du bar oder von einem anderen Konto bezahlt hast, erfasst du hier unten.
	</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Ausgaben {data.year}">
			<thead>
				<tr>
					<th>Datum</th>
					<th>Beschreibung</th>
					<th>Kategorie</th>
					<th>Betrifft</th>
					<th class="number">Betrag</th>
					<th><span class="visually-hidden">Aktion</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.expenses as expense (expense.id)}
					<tr>
						<td class="date">{formatDate(expense.date)}</td>
						<td>{expense.description}</td>
						<td>{expenseCategoryLabels[expense.category]}</td>
						<td class="muted">{expense.scopeLabel}</td>
						<td class="number"><Money cents={expense.amount} /></td>
						<td class="action">
							{#if expense.bankTransactionId}
								<a href="/bank?umsatz={expense.bankTransactionId}"><Badge>aus Bank</Badge></a>
							{:else}
								<ConfirmButton
									action="?/delete"
									label="Löschen"
									tone="secondary"
									message="Ausgabe „{expense.description}“ wirklich löschen?"
								>
									<input type="hidden" name="id" value={expense.id} />
								</ConfirmButton>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Ausgabe erfassen</h2>
<form method="POST" action="?/create" class="card" use:enhance>
	<div class="fields">
		<Field label="Datum" error={errors?.date}>
			<input
				type="date"
				name="date"
				defaultValue={values.date ?? data.today}
				aria-invalid={errors?.date ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Betrag" error={errors?.amount}>
			<input
				name="amount"
				inputmode="decimal"
				placeholder="0,00"
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
				{#each data.scopes as group (group.label)}
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
		<Field label="Beschreibung" error={errors?.description}>
			<input
				name="description"
				maxlength="200"
				placeholder="z. B. Heizungswartung"
				defaultValue={values.description ?? ''}
				aria-invalid={errors?.description ? 'true' : undefined}
				required
			/>
		</Field>
	</div>
	<div class="form-actions">
		<button type="submit">Ausgabe erfassen</button>
		{#if form && 'created' in form}
			<p role="status">Die Ausgabe wurde erfasst.</p>
		{/if}
	</div>
</form>

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
	.form-actions p {
		margin: 0;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
