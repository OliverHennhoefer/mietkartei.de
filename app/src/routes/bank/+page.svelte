<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatIban } from '#lib/domain/bank-matching.ts';
	import { pluralize } from '#lib/format.ts';
	import {
		bankTransactionStatusLabels,
		contraAccountKindShortLabels,
		expenseCategoryLabels,
		otherBookingKindLabels
	} from '#lib/labels.ts';
	import { formatCents, formatCentsPlain } from '#lib/money.ts';
	import { EXPENSE_SPLITS, splitTargetValue } from '#lib/expense-splits.ts';
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
	const otherErrors = $derived(
		form && 'otherErrors' in form ? (form.otherErrors as Record<string, string>) : undefined
	);
	const leases = $derived(new Map(data.leases.map((lease) => [lease.id, lease])));
	const contraAccounts = $derived(
		new Map(data.contraAccounts.map((account) => [account.id, account]))
	);
	const expenseAccounts = $derived(
		data.contraAccounts.filter((account) => account.kind === 'expense')
	);
	const otherKinds = new Set<string>(['capital_income', 'private', 'other_income']);
	const otherAccounts = $derived(
		data.contraAccounts.filter((account) => otherKinds.has(account.kind))
	);
	const otherKindEntries = Object.entries(otherBookingKindLabels);
	const properties = $derived(data.scopes.map((group) => ({ id: group.id, label: group.label })));

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
	 * A field of the expense form: what was typed before an error, else what the last expense to
	 * the same counterpart was booked as.
	 */
	function expenseValue(
		transaction: (typeof data.transactions)[number],
		name: 'category' | 'scope' | 'serviceProviderId' | 'contraAccountId'
	): string {
		if (formId === transaction.id) return values?.[name] ?? '';
		const suggested = transaction.contraSuggestion
			? contraAccounts.get(transaction.contraSuggestion)
			: undefined;
		if (suggested?.kind === 'expense') {
			if (name === 'contraAccountId') return suggested.id;
			if (name === 'category') return suggested.expenseCategory ?? '';
			if (name === 'scope' && suggested.propertyId) return `property:${suggested.propertyId}`;
		}
		return transaction.expensePreset?.[name] ?? '';
	}

	/** A further part of the expense form: what was typed before an error, else last time's. */
	function splitValue(
		transaction: (typeof data.transactions)[number],
		index: number,
		field: 'Target' | 'Amount'
	): string {
		if (formId === transaction.id) return values?.[`split${index}${field}`] ?? '';
		const split = transaction.expensePreset?.splits[index - 1];
		if (!split) return '';
		return field === 'Amount' ? formatCentsPlain(split.amount) : splitTargetValue(split);
	}

	/** A field of the other booking form: what was typed before an error, else the suggestion. */
	function otherValue(
		transaction: (typeof data.transactions)[number],
		name: 'contraAccountId' | 'kind' | 'propertyId'
	): string {
		if (formId === transaction.id) return values?.[name] ?? '';
		const suggested = transaction.contraSuggestion
			? contraAccounts.get(transaction.contraSuggestion)
			: undefined;
		if (!suggested || !otherKinds.has(suggested.kind)) return '';
		if (name === 'contraAccountId') return suggested.id;
		if (name === 'kind') return suggested.kind;
		return suggested.propertyId ?? '';
	}

	/**
	 * Choosing a Gegenkonto in the expense form fills in its category and property, so the landlord
	 * sees what is booked. Without JavaScript the server does the same for empty fields.
	 */
	function applyContraAccount(event: Event & { currentTarget: HTMLSelectElement }) {
		const account = contraAccounts.get(event.currentTarget.value);
		const fields = event.currentTarget.form?.elements;
		if (!account || !fields) return;
		const category = fields.namedItem('category');
		const scope = fields.namedItem('scope');
		if (category instanceof HTMLSelectElement && account.expenseCategory) {
			category.value = account.expenseCategory;
		}
		if (scope instanceof HTMLSelectElement) {
			scope.value = account.propertyId ? `property:${account.propertyId}` : '';
		}
	}

	/** Which form leads an open row: a Gegenkonto rule's kind, else rent or expense as before. */
	function leadingForm(transaction: Transaction): 'rent' | 'expense' | 'other' {
		const suggested = transaction.contraSuggestion
			? contraAccounts.get(transaction.contraSuggestion)
			: undefined;
		if (suggested && otherKinds.has(suggested.kind)) return 'other';
		if (suggested?.kind === 'expense') return 'expense';
		return expenseFirst(transaction) ? 'expense' : 'rent';
	}

	function expenseDescription(transaction: (typeof data.transactions)[number]): string {
		if (formId === transaction.id && values?.description !== undefined) return values.description;
		return (
			transaction.expensePreset?.description ??
			(transaction.counterpartName || transaction.purpose)
		).slice(0, 200);
	}

	type Transaction = (typeof data.transactions)[number];

	/**
	 * The expense form leads for money paid out, or from a counterpart booked as an expense before,
	 * that no lease is suggested for; otherwise the lease assignment is what the row is usually for.
	 */
	function expenseFirst(transaction: Transaction): boolean {
		return (
			(transaction.amount < 0 || transaction.expensePreset !== null) && !transaction.suggestion
		);
	}

	/** Money paid out is an expense; money coming in is booked as a refund, a negative expense. */
	function expenseLabel(transaction: (typeof data.transactions)[number]): string {
		return transaction.amount < 0 ? 'Als Ausgabe buchen' : 'Als Erstattung buchen';
	}

	const categoryEntries = Object.entries(expenseCategoryLabels);

	/**
	 * The second line of an assignment: what it was booked as and where, „Miete · Parkallee 8“,
	 * „Ausgabe · Lindenstraße 12 (ganzes Objekt)“; the share of the amount when it is split.
	 */
	function assignmentDetail(
		transaction: (typeof data.transactions)[number],
		assignment: (typeof data.transactions)[number]['assignments'][number]
	): string {
		const contra =
			'contraAccountId' in assignment && assignment.contraAccountId
				? contraAccounts.get(assignment.contraAccountId)
				: undefined;
		const kind = contra
			? contraAccountKindShortLabels[contra.kind]
			: { rent: 'Miete', deposit: 'Kaution', expense: 'Ausgabe', other: 'Sonstige Buchung' }[
					assignment.kind
				];
		const share =
			transaction.assignments.length > 1 ? ` ${formatCents(Math.abs(assignment.amount))}` : '';
		const where =
			assignment.kind === 'expense' || assignment.kind === 'other'
				? assignment.scope
				: leases.get(assignment.leaseId)?.property;
		const parts = [`${kind}${share}`, contra?.label, where].filter(Boolean);
		return parts.join(' · ');
	}
</script>

<!-- An open transaction offers the lease assignment and the expense form: the one that fits it
	leads with the main button, the other waits folded underneath. Ignoring sits with the leader. -->
{#snippet rentForm(transaction: Transaction, primary: boolean)}
	<form
		method="POST"
		action={action('assign')}
		class="assign rent"
		use:enhance={submitting(transaction.id)}
	>
		<input type="hidden" name="id" value={transaction.id} />
		<label>
			Mietvertrag
			<select
				name="leaseId"
				aria-invalid={formId === transaction.id && errors?.leaseId ? 'true' : undefined}
			>
				<option value="" selected={preselected(transaction) === ''}>– bitte wählen –</option>
				{#each data.leases as lease (lease.id)}
					<option value={lease.id} selected={preselected(transaction) === lease.id}>
						{lease.label}{transaction.suggestion?.leaseId === lease.id ? ' (Vorschlag)' : ''}
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
				{#if data.depositAgreed}
					<option value="deposit" selected={rowValue(transaction, 'target') === 'deposit'}>
						Kaution
					</option>
				{/if}
			</select>
		</label>
		<div class="row buttons">
			<button
				type="submit"
				class={primary ? undefined : 'secondary'}
				disabled={pending === transaction.id}
			>
				Zuordnen
			</button>
			{#if primary}
				<button
					type="submit"
					class="secondary"
					formaction={action('ignore')}
					disabled={pending === transaction.id}
				>
					Ignorieren
				</button>
			{/if}
		</div>
		{#if transaction.suggestion}
			<p class="muted small hint">
				Vorschlag: {sourceLabels[transaction.suggestion.source]}
			</p>
		{/if}
		{#if data.leases.length > 1}
			<details class="split" open={rowValue(transaction, 'splitLeaseId') !== ''}>
				<summary>Zahlung für zwei Verträge? Betrag aufteilen</summary>
				<div class="split-fields">
					<label>
						Zweiter Mietvertrag
						<select
							name="splitLeaseId"
							aria-invalid={formId === transaction.id && errors?.splitLeaseId ? 'true' : undefined}
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
							placeholder="0"
						/>
						{#if formId === transaction.id && errors?.splitAmount}
							<span class="error">{errors.splitAmount}</span>
						{/if}
					</label>
				</div>
			</details>
		{/if}
	</form>
{/snippet}

{#snippet expenseForm(transaction: Transaction, primary: boolean)}
	<form
		method="POST"
		action={action('expense')}
		class="assign"
		use:enhance={submitting(transaction.id)}
	>
		<input type="hidden" name="id" value={transaction.id} />
		{#if transaction.expensePreset}
			<p class="muted small preset">Vorbelegt wie die letzte Ausgabe an diesen Empfänger.</p>
		{/if}
		{#if expenseAccounts.length > 0}
			<label>
				Gegenkonto
				<select
					name="contraAccountId"
					onchange={applyContraAccount}
					aria-invalid={formId === transaction.id && expenseErrors?.contraAccountId
						? 'true'
						: undefined}
				>
					<option value="" selected={expenseValue(transaction, 'contraAccountId') === ''}>
						– ohne –
					</option>
					{#each expenseAccounts as account (account.id)}
						<option
							value={account.id}
							selected={expenseValue(transaction, 'contraAccountId') === account.id}
						>
							{account.label}
						</option>
					{/each}
				</select>
				{#if formId === transaction.id && expenseErrors?.contraAccountId}
					<span class="error">{expenseErrors.contraAccountId}</span>
				{/if}
			</label>
		{/if}
		<label>
			Kategorie
			<select
				name="category"
				aria-invalid={formId === transaction.id && expenseErrors?.category ? 'true' : undefined}
			>
				<option value="" selected={expenseValue(transaction, 'category') === ''}>
					– bitte wählen –
				</option>
				{#each categoryEntries as [value, label] (value)}
					<option {value} selected={expenseValue(transaction, 'category') === value}>
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
				aria-invalid={formId === transaction.id && expenseErrors?.scope ? 'true' : undefined}
			>
				<option value="" selected={expenseValue(transaction, 'scope') === ''}>
					Gesamter Bestand
				</option>
				{#each data.scopes as group (group.id)}
					<optgroup label={group.label}>
						{#each group.options as option (option.value)}
							<option
								value={option.value}
								selected={expenseValue(transaction, 'scope') === option.value}
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
		{#if data.serviceProviders.length > 0}
			<label>
				Dienstleister
				<select
					name="serviceProviderId"
					aria-invalid={formId === transaction.id && expenseErrors?.serviceProviderId
						? 'true'
						: undefined}
				>
					<option value="" selected={expenseValue(transaction, 'serviceProviderId') === ''}>
						Unbekannt
					</option>
					{#each data.serviceProviders as provider (provider.id)}
						<option
							value={provider.id}
							selected={expenseValue(transaction, 'serviceProviderId') === provider.id}
						>
							{provider.name}
						</option>
					{/each}
				</select>
				{#if formId === transaction.id && expenseErrors?.serviceProviderId}
					<span class="error">{expenseErrors.serviceProviderId}</span>
				{/if}
			</label>
		{/if}
		<details class="split" open={splitValue(transaction, 1, 'Target') !== ''}>
			<summary>Auf mehrere Konten aufteilen? Etwa Hausgeld oder Darlehensrate</summary>
			<p class="muted small hint">
				Trage die weiteren Teile ein, etwa die Rücklage oder die Tilgung. Der Rest bleibt auf dem
				Konto oben.
			</p>
			{#each Array.from({ length: EXPENSE_SPLITS }, (_, index) => index + 1) as index (index)}
				{@const targetField = `split${index}Target`}
				{@const amountField = `split${index}Amount`}
				<div class="split-fields">
					<label>
						Teil {index + 1}
						<select
							name={targetField}
							aria-invalid={formId === transaction.id && expenseErrors?.[targetField]
								? 'true'
								: undefined}
						>
							<option value="" selected={splitValue(transaction, index, 'Target') === ''}>
								– kein weiterer Teil –
							</option>
							{#if expenseAccounts.length > 0}
								<optgroup label="Gegenkonten">
									{#each expenseAccounts as account (account.id)}
										<option
											value="contra:{account.id}"
											selected={splitValue(transaction, index, 'Target') === `contra:${account.id}`}
										>
											{account.label}
										</option>
									{/each}
								</optgroup>
							{/if}
							<optgroup label="Kategorien">
								{#each categoryEntries as [value, label] (value)}
									<option
										value="category:{value}"
										selected={splitValue(transaction, index, 'Target') === `category:${value}`}
									>
										{label}
									</option>
								{/each}
							</optgroup>
						</select>
						{#if formId === transaction.id && expenseErrors?.[targetField]}
							<span class="error">{expenseErrors[targetField]}</span>
						{/if}
					</label>
					<label>
						Betrag Teil {index + 1}
						<input
							name={amountField}
							inputmode="decimal"
							defaultValue={splitValue(transaction, index, 'Amount')}
							placeholder="0"
							aria-invalid={formId === transaction.id && expenseErrors?.[amountField]
								? 'true'
								: undefined}
						/>
						{#if formId === transaction.id && expenseErrors?.[amountField]}
							<span class="error">{expenseErrors[amountField]}</span>
						{/if}
					</label>
				</div>
			{/each}
		</details>
		<label>
			Beschreibung
			<input
				name="description"
				maxlength="200"
				defaultValue={expenseDescription(transaction)}
				aria-invalid={formId === transaction.id && expenseErrors?.description ? 'true' : undefined}
			/>
			{#if formId === transaction.id && expenseErrors?.description}
				<span class="error">{expenseErrors.description}</span>
			{/if}
		</label>
		<div class="row buttons">
			<button
				type="submit"
				class={primary ? undefined : 'secondary'}
				disabled={pending === transaction.id}
			>
				{expenseLabel(transaction)}
			</button>
			{#if primary}
				<button
					type="submit"
					class="secondary"
					formaction={action('ignore')}
					disabled={pending === transaction.id}
				>
					Ignorieren
				</button>
			{/if}
		</div>
	</form>
{/snippet}

{#snippet otherForm(transaction: Transaction, primary: boolean)}
	<form
		method="POST"
		action={action('other')}
		class="assign"
		use:enhance={submitting(transaction.id)}
	>
		<input type="hidden" name="id" value={transaction.id} />
		{#if otherAccounts.length > 0}
			<label>
				Gegenkonto
				<select
					name="contraAccountId"
					aria-invalid={formId === transaction.id && otherErrors?.contraAccountId
						? 'true'
						: undefined}
				>
					<option value="" selected={otherValue(transaction, 'contraAccountId') === ''}>
						– nach Art –
					</option>
					{#each otherAccounts as account (account.id)}
						<option
							value={account.id}
							selected={otherValue(transaction, 'contraAccountId') === account.id}
						>
							{account.label}
						</option>
					{/each}
				</select>
				{#if formId === transaction.id && otherErrors?.contraAccountId}
					<span class="error">{otherErrors.contraAccountId}</span>
				{/if}
			</label>
		{/if}
		<label>
			Art{otherAccounts.length > 0 ? ' (ohne Gegenkonto)' : ''}
			<select
				name="kind"
				aria-invalid={formId === transaction.id && otherErrors?.kind ? 'true' : undefined}
			>
				<option value="" selected={otherValue(transaction, 'kind') === ''}>– bitte wählen –</option>
				{#each otherKindEntries as [value, label] (value)}
					<option {value} selected={otherValue(transaction, 'kind') === value}>{label}</option>
				{/each}
			</select>
			{#if formId === transaction.id && otherErrors?.kind}
				<span class="error">{otherErrors.kind}</span>
			{/if}
		</label>
		{#if properties.length > 0}
			<label>
				Objekt
				<select name="propertyId">
					<option value="" selected={otherValue(transaction, 'propertyId') === ''}>
						– keins –
					</option>
					{#each properties as property (property.id)}
						<option
							value={property.id}
							selected={otherValue(transaction, 'propertyId') === property.id}
						>
							{property.label}
						</option>
					{/each}
				</select>
				{#if formId === transaction.id && otherErrors?.propertyId}
					<span class="error">{otherErrors.propertyId}</span>
				{/if}
			</label>
		{/if}
		<label>
			Beschreibung
			<input
				name="description"
				maxlength="200"
				defaultValue={formId === transaction.id
					? (values?.description ?? '')
					: transaction.purpose.slice(0, 200)}
			/>
		</label>
		<div class="row buttons">
			<button
				type="submit"
				class={primary ? undefined : 'secondary'}
				disabled={pending === transaction.id}
			>
				Buchen
			</button>
			{#if primary}
				<button
					type="submit"
					class="secondary"
					formaction={action('ignore')}
					disabled={pending === transaction.id}
				>
					Ignorieren
				</button>
			{/if}
		</div>
		<p class="muted small hint">
			Kapitalerträge, Privatentnahmen und -einlagen zählen nicht als Mieteinnahme oder Ausgabe.
		</p>
	</form>
{/snippet}

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Umsätze" tab. -->
<h2 class="visually-hidden">Umsätze</h2>

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
				<select name="konto" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
					<option value="" selected={!data.bankAccountId}>alle</option>
					{#each data.bankAccounts as account (account.id)}
						<option value={account.id} selected={data.bankAccountId === account.id}>
							{account.name}
						</option>
					{/each}
				</select>
			</label>
			<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
		</form>
	{/if}
</div>

{#if message}
	<Alert tone="danger"><p>{message}</p></Alert>
{/if}

<!-- An ignored transaction leaves the list of open ones; this brings it back at once. Later it is
     under the filter „Ignoriert“ with „Wieder öffnen“. -->
{#if form && 'ignored' in form}
	<Alert tone="success">
		<form method="POST" action={action('reopen')} class="row" use:enhance>
			<input type="hidden" name="id" value={form.ignored} />
			<span>
				Der Umsatz wird ignoriert. Du findest ihn unter
				<a href={filterHref('ignored')}>{bankTransactionStatusLabels.ignored}</a>.
			</span>
			<button type="submit" class="secondary small">Rückgängig</button>
		</form>
	</Alert>
{:else if form && 'reopened' in form}
	<Alert tone="success"><p>Der Umsatz ist wieder offen.</p></Alert>
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
		<CreateButton href="/bank/konten#bankverbindung-anlegen" label="Bankverbindung anlegen" />
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
	<p class="muted small">
		Ordnest du einen Umsatz als Miete einem Mietvertrag zu, merkt sich Mietkartei den Zahler für den
		nächsten Import.
	</p>
	<!-- One row per transaction, like a bank statement: the status, the date, who and what for, where
	     the money was booked and the amount. An open row has its assignment forms below it. -->
	<ul
		class="transactions card"
		class:trailing={data.transactions.some((transaction) => transaction.status !== 'unmatched')}
		aria-label="Umsätze"
	>
		{#each data.transactions as transaction (transaction.id)}
			<li class="transaction {transaction.status}">
				<div class="line">
					<span class="status" title={bankTransactionStatusLabels[transaction.status]}
						><span class="visually-hidden">{bankTransactionStatusLabels[transaction.status]}</span
						></span
					>
					<span class="date">{formatDate(transaction.bookingDate)}</span>
					<div class="who">
						<strong
							title={transaction.counterpartIban
								? formatIban(transaction.counterpartIban)
								: undefined}>{transaction.counterpartName || 'ohne Namen'}</strong
						>
						<span class="muted small purpose">{transaction.purpose || '–'}</span>
					</div>
					{#if transaction.status === 'matched'}
						<ul class="assignments">
							{#each transaction.assignments as assignment (assignment.id)}
								{@const lease =
									assignment.kind === 'expense' || assignment.kind === 'other'
										? undefined
										: leases.get(assignment.leaseId)}
								<li>
									<span class="target"
										>{assignment.kind === 'expense'
											? expenseCategoryLabels[assignment.category]
											: assignment.kind === 'other'
												? otherBookingKindLabels[assignment.otherKind]
												: (lease?.unit ?? 'Unbekannter Mietvertrag')}</span
									>
									<span class="muted small">{assignmentDetail(transaction, assignment)}</span>
								</li>
							{/each}
						</ul>
					{/if}
					<Money cents={transaction.amount} signed />
					<!-- The account only where the list mixes several. -->
					{#if data.bankAccounts.length > 1 && !data.bankAccountId}
						<span class="muted small account" title={transaction.bankAccountName}
							>{transaction.bankAccountName}</span
						>
					{/if}
					{#if transaction.status === 'matched'}
						<div class="trailing-action">
							<ConfirmButton
								action={action('undo')}
								label="Zuordnung aufheben"
								tone="secondary"
								small
								message="Zuordnung aufheben? Die gebuchten Zahlungen, Kautionsbewegungen, Ausgaben oder sonstigen Buchungen werden gelöscht."
							>
								<input type="hidden" name="id" value={transaction.id} />
							</ConfirmButton>
						</div>
					{:else if transaction.status === 'ignored'}
						<form
							method="POST"
							action={action('reopen')}
							class="trailing-action"
							use:enhance={submitting(transaction.id)}
						>
							<input type="hidden" name="id" value={transaction.id} />
							<button type="submit" class="secondary small" disabled={pending === transaction.id}>
								Wieder öffnen
							</button>
						</form>
					{/if}
				</div>

				{#if transaction.status === 'unmatched'}
					{@const lead = leadingForm(transaction)}
					<div class="work">
						{#if lead === 'rent'}
							{@render rentForm(transaction, true)}
						{:else if lead === 'expense'}
							{@render expenseForm(transaction, true)}
						{:else}
							{@render otherForm(transaction, true)}
						{/if}
						{#if lead !== 'rent'}
							<details class="alternative" open={formId === transaction.id && errors !== undefined}>
								<summary>Stattdessen einem Mietvertrag zuordnen</summary>
								{@render rentForm(transaction, false)}
							</details>
						{/if}
						{#if lead !== 'expense'}
							<details
								class="alternative"
								open={formId === transaction.id && expenseErrors !== undefined}
							>
								<summary>{expenseLabel(transaction)}</summary>
								{@render expenseForm(transaction, false)}
							</details>
						{/if}
						{#if lead !== 'other'}
							<details
								class="alternative"
								open={formId === transaction.id && otherErrors !== undefined}
							>
								<summary>Kapitalertrag, Privat oder sonstige Einnahme buchen</summary>
								{@render otherForm(transaction, false)}
							</details>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	/* The list is a container: a wide one lays each row out in aligned columns (status, date, who,
	   booked to, amount, action); a narrow one stacks them under the name and amount. */
	.transactions {
		container-type: inline-size;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.transaction {
		padding: 0.9rem 1.25rem;
	}
	.transaction + .transaction {
		border-top: 1px solid var(--color-border);
	}
	.line {
		display: grid;
		grid-template-columns: 0.625rem minmax(0, 1fr) auto;
		grid-template-areas:
			'status who amount'
			'. date date'
			'. assignments assignments'
			'. action action';
		gap: 0.15rem 0.75rem;
		align-items: start;
	}
	/* The status as a dot, the word for screen readers and on hover: a ring while the transaction is
	   open, a green dot once assigned, a grey dot when ignored. */
	.status {
		grid-area: status;
		width: 0.625rem;
		height: 0.625rem;
		margin-top: 0.4rem;
		border-radius: 50%;
		box-sizing: border-box;
	}
	.unmatched .status {
		border: 2px solid var(--color-text);
	}
	.matched .status {
		background: var(--color-success);
		box-shadow: 0 0 0 3px var(--color-success-subtle);
	}
	.ignored .status {
		background: var(--color-muted);
		opacity: 0.6;
	}
	.date {
		grid-area: date;
		font-variant-numeric: tabular-nums;
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.who {
		grid-area: who;
		min-width: 0;
	}
	.who strong,
	.purpose,
	.target {
		display: block;
	}
	.who strong {
		font-weight: 600;
	}
	.purpose {
		overflow-wrap: anywhere;
	}
	.ignored .who strong,
	.ignored .line > :global(.money) {
		color: var(--color-muted);
		font-weight: 400;
	}
	.assignments {
		grid-area: assignments;
		display: grid;
		gap: 0.35rem;
		min-width: 0;
		margin: 0.35rem 0 0;
		padding: 0;
		list-style: none;
	}
	.line > :global(.money) {
		grid-area: amount;
		justify-self: end;
		font-weight: 500;
	}
	/* A long account name is cut, whole on hover: the amounts stay one column. */
	/* On a phone the account shares the date's line, at its right end. */
	.account {
		grid-area: date;
		justify-self: end;
		max-width: calc(100% - 6.5rem);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 400;
	}
	.trailing-action {
		grid-area: action;
		margin-top: 0.5rem;
	}
	/* What to do with an open transaction: a quiet panel under its row. */
	.work {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		margin-top: 0.75rem;
		padding: 1rem;
		border-radius: var(--radius);
		background: var(--color-subtle);
	}
	.assign {
		display: grid;
		gap: 0.5rem;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		align-items: start;
	}
	.assign .split,
	.assign .row,
	.assign .hint,
	.assign .error,
	.assign .preset {
		grid-column: 1 / -1;
	}
	.split-fields {
		display: grid;
		gap: 0.5rem;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		margin-top: 0.5rem;
	}
	.alternative {
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}
	.preset,
	.hint {
		margin: 0;
	}
	.alternative .assign {
		margin-top: 0.5rem;
	}
	nav a[aria-current='page'] {
		font-weight: 600;
	}
	@container (min-width: 52rem) {
		.line {
			grid-template-columns: 0.625rem 5.5rem minmax(0, 3fr) minmax(0, 2fr) 11rem;
			grid-template-areas:
				'status date who assignments amount'
				'. . who assignments account';
			/* A taller name or assignment leaves the account right under the amount. */
			grid-template-rows: auto 1fr;
			gap: 0 1rem;
		}
		.trailing .line {
			grid-template-columns: 0.625rem 5.5rem minmax(0, 3fr) minmax(0, 2fr) 11rem 11rem;
			grid-template-areas:
				'status date who assignments amount action'
				'. . who assignments account action';
		}
		/* Without an assignment the name and purpose take its column too. */
		.unmatched .who,
		.ignored .who {
			grid-area: who-start / who-start / who-end / assignments-end;
		}
		.date {
			color: inherit;
			font-size: inherit;
		}
		.account {
			grid-area: account;
			max-width: 100%;
		}
		.assignments {
			margin-top: 0;
		}
		.trailing-action {
			margin-top: 0;
			justify-self: end;
		}
		/* The forms line up with the name above them. */
		.work {
			margin-left: calc(0.625rem + 5.5rem + 2rem);
		}
		/* Lease labels are long, so the lease gets the wider column; the buttons sit beside the
		   selects. */
		.rent {
			grid-template-columns: minmax(0, 2fr) minmax(10rem, 1fr) auto;
			align-items: end;
		}
		.rent .buttons {
			grid-column: auto;
		}
	}
</style>
