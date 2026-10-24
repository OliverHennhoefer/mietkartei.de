<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatIban } from '#lib/domain/bank-matching.ts';
	import { pluralize } from '#lib/format.ts';
	import { bankTransactionStatusLabels, expenseCategoryLabels } from '#lib/labels.ts';
	import { formatCents } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The row whose form is on its way: its buttons are disabled, so a double click sends one
	// request (the server refuses a second assignment anyway).
	let pending = $state<string | null>(null);
	function submitting(id: string): SubmitFunction {
		return () => {
			pending = id;
			return async ({ update }) => {
				try {
					await update();
				} finally {
					pending = null;
				}
			};
		};
	}

	// Actions keep the filter: a submission lands on the page it was sent from, query and all.
	function action(name: string): string {
		return page.url.search ? `${page.url.search}&/${name}` : `?/${name}`;
	}

	// The action's answer belongs to one row: errors and values are shown in that row only.
	const formId = $derived(form && 'id' in form ? form.id : undefined);
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const expenseErrors = $derived(
		form && 'expenseErrors' in form ? (form.expenseErrors as Record<string, string>) : undefined
	);
	const leaseLabels = $derived(new Map(data.leases.map((lease) => [lease.id, lease.label])));

	const filters = [
		{ status: 'unmatched', label: bankTransactionStatusLabels.unmatched },
		{ status: 'matched', label: bankTransactionStatusLabels.matched },
		{ status: 'ignored', label: bankTransactionStatusLabels.ignored },
		{ status: 'all', label: 'Alle' }
	] as const;

	function filterHref(status: string, bankAccountId: string | null = data.bankAccountId): string {
		const params: string[] = [];
		if (status !== 'unmatched') params.push(`status=${status}`);
		if (bankAccountId) params.push(`konto=${encodeURIComponent(bankAccountId)}`);
		return params.length ? `/bank?${params.join('&')}` : '/bank';
	}

	const sourceLabels = {
		rule: 'nach Regel',
		iban: 'gleiche IBAN wie früher',
		name: 'Name des Mieters im Text',
		unit: 'Name der Einheit im Text'
	} as const;

	/** The lease preselected in a row: what was typed before an error, else the suggestion. */
	function preselected(transaction: (typeof data.transactions)[number]): string {
		if (formId === transaction.id && values?.leaseId) return values.leaseId;
		return transaction.suggestion?.leaseId ?? '';
	}

	function rowValue(transaction: { id: string }, name: string): string {
		return formId === transaction.id ? (values?.[name] ?? '') : '';
	}

	/**
	 * The expense form starts open for money paid out that no lease is suggested for, and after
	 * its own refusal; otherwise the lease assignment is what the row is usually for.
	 */
	function expenseOpen(transaction: (typeof data.transactions)[number]): boolean {
		if (formId === transaction.id && expenseErrors) return true;
		return transaction.amount < 0 && !transaction.suggestion;
	}

	const categoryEntries = Object.entries(expenseCategoryLabels);
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Umsätze" tab. -->
<h2>Umsätze</h2>

<div class="toolbar">
	<strong>{pluralize(data.openCount, 'offener Umsatz', 'offene Umsätze')}</strong>
	<nav class="row" aria-label="Status">
		{#each filters as filter (filter.status)}
			<a
				href={filterHref(filter.status)}
				class="button small {data.status === filter.status ? '' : 'secondary'}"
				aria-current={data.status === filter.status ? 'page' : undefined}
			>
				{filter.label}
			</a>
		{/each}
	</nav>
	{#if data.bankAccounts.length > 1}
		<form method="GET" class="row">
			{#if data.status !== 'unmatched'}<input
					type="hidden"
					name="status"
					value={data.status}
				/>{/if}
			<label class="inline">
				Konto
				<select name="konto">
					<option value="" selected={!data.bankAccountId}>alle</option>
					{#each data.bankAccounts as account (account.id)}
						<option value={account.id} selected={data.bankAccountId === account.id}>
							{account.name}
						</option>
					{/each}
				</select>
			</label>
			<button type="submit" class="secondary small">Anzeigen</button>
		</form>
	{/if}
	<a href="/bank/import">Kontoauszug importieren</a>
</div>

{#if message}
	<Alert tone="danger"><p>{message}</p></Alert>
{/if}

{#if data.transactionId}
	<Alert tone="info">
		<p>
			Es wird nur ein Umsatz angezeigt, der aus dem Mietkonto oder der Kaution verlinkt ist.
			<a href="/bank?status=all">Alle Umsätze anzeigen</a>
		</p>
	</Alert>
{/if}

{#if data.bankAccounts.length === 0}
	<EmptyState
		title="Noch keine Bankverbindung"
		text="Lege zuerst das Konto an, auf dem die Mieten eingehen; danach kannst du Kontoauszüge importieren."
	>
		<a href="/bank/konten">Bankverbindung anlegen</a>
	</EmptyState>
{:else if data.transactions.length === 0}
	{#if data.transactionId}
		<p>Diesen Umsatz gibt es nicht mehr.</p>
	{:else if data.status === 'unmatched'}
		<p>Alle Umsätze sind zugeordnet oder ignoriert.</p>
	{:else}
		<p>Keine Umsätze mit diesem Status.</p>
	{/if}
{:else}
	{#if data.more}
		<Alert tone="info">
			<p>
				Es werden nur die neuesten 200 Umsätze angezeigt. Grenze die Liste über den Status oder das
				Konto ein.
			</p>
		</Alert>
	{/if}
	<ul class="list" aria-label="Umsätze">
		{#each data.transactions as transaction (transaction.id)}
			<li class="card transaction">
				<div class="head">
					<div class="who">
						<span class="date">{formatDate(transaction.bookingDate)}</span>
						<strong>{transaction.counterpartName || 'ohne Namen'}</strong>
						{#if transaction.counterpartIban}
							<span class="muted small">{formatIban(transaction.counterpartIban)}</span>
						{/if}
						<span class="purpose">{transaction.purpose || '–'}</span>
						{#if data.bankAccounts.length > 1}
							<span class="muted small">{transaction.bankAccountName}</span>
						{/if}
					</div>
					<div class="amount">
						<Money cents={transaction.amount} signed />
						{#if transaction.status === 'matched'}
							<Badge tone="success">{bankTransactionStatusLabels.matched}</Badge>
						{:else if transaction.status === 'ignored'}
							<Badge>{bankTransactionStatusLabels.ignored}</Badge>
						{:else}
							<Badge tone="warning">{bankTransactionStatusLabels.unmatched}</Badge>
						{/if}
					</div>
				</div>

				{#if transaction.status === 'unmatched'}
					<form
						method="POST"
						action={action('assign')}
						class="assign"
						use:enhance={submitting(transaction.id)}
					>
						<input type="hidden" name="id" value={transaction.id} />
						<label>
							Mietvertrag
							{#if transaction.suggestion}
								<span class="muted small">
									Vorschlag: {sourceLabels[transaction.suggestion.source]}
								</span>
							{/if}
							<select
								name="leaseId"
								aria-invalid={formId === transaction.id && errors?.leaseId ? 'true' : undefined}
							>
								<option value="" selected={preselected(transaction) === ''}>– bitte wählen –</option
								>
								{#each data.leases as lease (lease.id)}
									<option value={lease.id} selected={preselected(transaction) === lease.id}>
										{lease.label}{transaction.suggestion?.leaseId === lease.id
											? ' (Vorschlag)'
											: ''}
									</option>
								{/each}
							</select>
							{#if formId === transaction.id && errors?.leaseId}
								<span class="error">{errors.leaseId}</span>
							{/if}
						</label>
						<label>
							Buchen als
							<select name="target">
								<option value="rent" selected={rowValue(transaction, 'target') !== 'deposit'}>
									Miete (Zahlung)
								</option>
								<option value="deposit" selected={rowValue(transaction, 'target') === 'deposit'}>
									Kaution
								</option>
							</select>
						</label>
						<details class="split" open={rowValue(transaction, 'splitLeaseId') !== ''}>
							<summary>Auf zwei Mietverträge aufteilen</summary>
							<div class="split-fields">
								<label>
									Zweiter Mietvertrag
									<select
										name="splitLeaseId"
										aria-invalid={formId === transaction.id && errors?.splitLeaseId
											? 'true'
											: undefined}
									>
										<option value="" selected={rowValue(transaction, 'splitLeaseId') === ''}>
											– keine Aufteilung –
										</option>
										{#each data.leases as lease (lease.id)}
											<option
												value={lease.id}
												selected={rowValue(transaction, 'splitLeaseId') === lease.id}
											>
												{lease.label}
											</option>
										{/each}
									</select>
									{#if formId === transaction.id && errors?.splitLeaseId}
										<span class="error">{errors.splitLeaseId}</span>
									{/if}
								</label>
								<label>
									Betrag erster Vertrag
									<input
										name="amount"
										inputmode="decimal"
										defaultValue={rowValue(transaction, 'amount')}
										placeholder={formatCents(Math.abs(transaction.amount))}
									/>
									{#if formId === transaction.id && errors?.amount}
										<span class="error">{errors.amount}</span>
									{/if}
								</label>
								<label>
									Betrag zweiter Vertrag
									<input
										name="splitAmount"
										inputmode="decimal"
										defaultValue={rowValue(transaction, 'splitAmount')}
										placeholder="0,00"
									/>
									{#if formId === transaction.id && errors?.splitAmount}
										<span class="error">{errors.splitAmount}</span>
									{/if}
								</label>
							</div>
						</details>
						<label class="inline">
							<input
								type="checkbox"
								name="remember"
								checked={rowValue(transaction, 'remember') === 'on'}
							/>
							Zuordnung merken
						</label>
						{#if formId === transaction.id && errors?.remember}
							<span class="error">{errors.remember}</span>
						{/if}
						<div class="row">
							<button type="submit" disabled={pending === transaction.id}>Zuordnen</button>
							<button
								type="submit"
								class="secondary"
								formaction={action('ignore')}
								disabled={pending === transaction.id}
							>
								Ignorieren
							</button>
						</div>
					</form>
					<details class="expense" open={expenseOpen(transaction)}>
						<summary>Als Ausgabe buchen</summary>
						<form
							method="POST"
							action={action('expense')}
							class="assign"
							use:enhance={submitting(transaction.id)}
						>
							<input type="hidden" name="id" value={transaction.id} />
							<label>
								Kategorie
								<select
									name="category"
									aria-invalid={formId === transaction.id && expenseErrors?.category
										? 'true'
										: undefined}
								>
									<option value="" selected={rowValue(transaction, 'category') === ''}>
										– bitte wählen –
									</option>
									{#each categoryEntries as [value, label] (value)}
										<option {value} selected={rowValue(transaction, 'category') === value}>
											{label}
										</option>
									{/each}
								</select>
								{#if formId === transaction.id && expenseErrors?.category}
									<span class="error">{expenseErrors.category}</span>
								{/if}
							</label>
							<label>
								Betrifft
								<select
									name="scope"
									aria-invalid={formId === transaction.id && expenseErrors?.scope
										? 'true'
										: undefined}
								>
									<option value="" selected={rowValue(transaction, 'scope') === ''}>
										Gesamter Bestand
									</option>
									{#each data.scopes as group (group.id)}
										<optgroup label={group.label}>
											{#each group.options as option (option.value)}
												<option
													value={option.value}
													selected={rowValue(transaction, 'scope') === option.value}
												>
													{option.label}
												</option>
											{/each}
										</optgroup>
									{/each}
								</select>
								{#if formId === transaction.id && expenseErrors?.scope}
									<span class="error">{expenseErrors.scope}</span>
								{/if}
							</label>
							<label>
								Beschreibung
								<input
									name="description"
									maxlength="200"
									defaultValue={formId === transaction.id && values?.description !== undefined
										? values.description
										: (transaction.counterpartName || transaction.purpose).slice(0, 200)}
									aria-invalid={formId === transaction.id && expenseErrors?.description
										? 'true'
										: undefined}
								/>
								{#if formId === transaction.id && expenseErrors?.description}
									<span class="error">{expenseErrors.description}</span>
								{/if}
							</label>
							<div class="row">
								<button type="submit" disabled={pending === transaction.id}>
									Als Ausgabe buchen
								</button>
							</div>
						</form>
					</details>
				{:else if transaction.status === 'matched'}
					<div class="row between">
						<ul class="assignments">
							{#each transaction.assignments as assignment (assignment.id)}
								<li>
									{#if assignment.kind === 'expense'}
										Ausgabe <Money cents={assignment.amount} />
										({expenseCategoryLabels[assignment.category]}) → {assignment.scope}
									{:else}
										{assignment.kind === 'rent' ? 'Zahlung' : 'Kaution'}
										<Money cents={assignment.amount} signed />
										→ {leaseLabels.get(assignment.leaseId) ?? 'Unbekannter Mietvertrag'}
									{/if}
								</li>
							{/each}
						</ul>
						<ConfirmButton
							action={action('undo')}
							label="Zuordnung aufheben"
							tone="secondary"
							message="Zuordnung aufheben? Die gebuchten Zahlungen, Kautionsbewegungen oder Ausgaben werden gelöscht."
						>
							<input type="hidden" name="id" value={transaction.id} />
						</ConfirmButton>
					</div>
				{:else}
					<form method="POST" action={action('reopen')} use:enhance={submitting(transaction.id)}>
						<input type="hidden" name="id" value={transaction.id} />
						<button type="submit" class="secondary small" disabled={pending === transaction.id}>
							Wieder öffnen
						</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.transaction {
		display: grid;
		gap: 0.75rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem 1.5rem;
	}
	.who {
		display: grid;
		gap: 0.15rem;
	}
	.date {
		font-variant-numeric: tabular-nums;
	}
	.purpose {
		overflow-wrap: anywhere;
	}
	.amount {
		display: grid;
		justify-items: end;
		gap: 0.25rem;
		font-size: 1.1rem;
	}
	.assign {
		display: grid;
		gap: 0.5rem;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		align-items: start;
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}
	.assign .split,
	.assign .inline,
	.assign .row,
	.assign .error {
		grid-column: 1 / -1;
	}
	.split-fields {
		display: grid;
		gap: 0.5rem;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		margin-top: 0.5rem;
	}
	.expense {
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}
	.expense .assign {
		border-top: none;
		margin-top: 0.5rem;
		padding-top: 0;
	}
	.assignments {
		margin: 0;
		padding-left: 1.25rem;
	}
	nav a[aria-current='page'] {
		font-weight: 600;
	}
	@media (max-width: 40rem) {
		/* The amount stays top right, however long the purpose. */
		.head {
			flex-wrap: nowrap;
		}
		.who {
			min-width: 0;
		}
		.amount {
			align-content: start;
			white-space: nowrap;
		}
	}
</style>
