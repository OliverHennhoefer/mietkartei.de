<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { formatRate } from '#lib/domain/default-interest.ts';
	import { reminderLevelLabels } from '#lib/domain/reminders.ts';
	import { formatCents, formatCentsPlain } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Each form keeps its own errors and values; the other one re-renders with its defaults.
	const failed = $derived(form && 'errors' in form ? form : undefined);
	const paymentErrors = $derived(failed?.form === 'payment' ? failed.errors : undefined);
	const paymentValues = $derived(failed?.form === 'payment' ? failed.values : undefined);
	const adjustmentErrors = $derived(failed?.form === 'adjustment' ? failed.errors : undefined);
	const adjustmentValues = $derived(failed?.form === 'adjustment' ? failed.values : undefined);
	const editErrors = $derived(failed?.form === 'edit' ? failed.errors : undefined);
	// After a refused save the typed values win; otherwise the dialog shows the line as stored.
	const editValues = $derived(
		(failed?.form === 'edit' ? failed.values : undefined) ??
			(data.editing && {
				date: data.editing.date,
				amount: formatCentsPlain(Math.abs(data.editing.amount)),
				note: data.editing.note ?? '',
				side:
					data.editing.kind === 'payment'
						? data.editing.amount < 0
							? 'refund'
							: 'received'
						: data.editing.amount < 0
							? 'credit'
							: 'claim'
			})
	);
	const base = $derived(`/vertraege/${data.lease.id}/mietkonto`);
	/** The page with the shown months kept and another parameter, for the dialogs' links. */
	const withRange = (name?: string, value?: string) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read once, for a link
		const query = new URLSearchParams({ from: data.range.from, to: data.range.to });
		if (name && value) query.set(name, value);
		return `${base}?${query}`;
	};
	const reminderErrors = $derived(failed?.form === 'reminder' ? failed.errors : undefined);
	const reminderValues = $derived(failed?.form === 'reminder' ? failed.values : undefined);

	const reminderPdf = (id: string) => `/vertraege/${data.lease.id}/mietkonto/schreiben/${id}`;
	const reminderTitle = (reminder: (typeof data.reminders.reminders)[number]) =>
		`${reminderLevelLabels[reminder.level]} vom ${formatDate(reminder.date)}`;
	const created = $derived(
		form?.reminderId
			? data.reminders.reminders.find((reminder) => reminder.id === form.reminderId)
			: undefined
	);
	const latest = $derived(data.reminders.current[0]);
	const interestBasis = $derived.by(() => {
		const rate = data.reminders.baseRates.latest;
		const basis = 'Fünf Prozentpunkte über dem Basiszinssatz (§ 288 Abs. 1 BGB)';
		return rate
			? `${basis}, der seit ${formatDate(rate.validFrom)} ${formatRate(rate.rate)} beträgt (Quelle: Deutsche Bundesbank).`
			: `${basis}.`;
	});
	const baseRateError = $derived(
		data.reminders.baseRates.error ? ` (${data.reminders.baseRates.error})` : ''
	);

	let paymentForm = $state<HTMLFormElement>();

	/** Fills the payment form like the last payment: today, its amount and its note. */
	function repeatLastPayment() {
		const last = data.lastPayment;
		if (!last || !paymentForm) return;
		const amount = paymentForm.elements.namedItem('amount');
		const note = paymentForm.elements.namedItem('note');
		const side = paymentForm.elements.namedItem('side');
		if (amount instanceof HTMLInputElement) amount.value = formatCentsPlain(Math.abs(last.amount));
		if (note instanceof HTMLInputElement) note.value = last.note ?? '';
		if (side instanceof HTMLSelectElement) side.value = last.amount < 0 ? 'refund' : 'received';
	}
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Mietkonto" tab. -->
<h2 class="visually-hidden">Mietkonto</h2>

<div class="toolbar">
	<form method="GET" class="row" aria-label="Zeitraum">
		<label class="inline">
			von
			<input type="month" name="from" value={data.range.from} required />
		</label>
		<label class="inline">
			bis
			<input type="month" name="to" value={data.range.to} required />
		</label>
		<button type="submit" class="secondary small">Anzeigen</button>
	</form>
	<a class="small" href="/mietkonto">Alle Mietkonten</a>
</div>

{#if form && 'message' in form}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{:else if form && 'booked' in form}
	<Alert tone="success">
		<p>{form.booked === 'payment' ? 'Zahlung gebucht.' : 'Korrektur gebucht.'}</p>
	</Alert>
{:else if form?.reminderId}
	<Alert tone="success">
		<p>
			Schreiben erstellt.
			<PreviewLink
				href={reminderPdf(form.reminderId)}
				text="{reminderPdf(form.reminderId)}/text"
				title={created ? reminderTitle(created) : 'Schreiben'}>Schreiben ansehen</PreviewLink
			>
		</p>
	</Alert>
{/if}

<p class="balance">
	<strong>Saldo <Balance cents={data.balance} label /></strong>
	<span class="muted small">
		über alle Buchungen · {formatMonth(data.range.from)} bis {formatMonth(data.range.to)} unten
	</span>
</p>

{#if data.rows.length === 0}
	<p class="muted">In diesem Zeitraum gibt es keine Buchungen.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Buchungen">
			<thead>
				<tr>
					<th>Datum</th>
					<th>Buchung</th>
					<th class="num">Soll</th>
					<th class="num">Haben</th>
					<th class="num">
						Saldo
						<span class="legend">+ Guthaben · − Rückstand</span>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr>
						<td>
							{#if row.deletable}
								<a href={withRange('bearbeiten', row.id)} data-sveltekit-reset="false"
									>{formatDate(row.date)}</a
								>
							{:else}
								{formatDate(row.date)}
							{/if}
						</td>
						<td>
							{row.label}
							{#if row.fromBank}
								<!-- Changed or undone at the bank transaction, so the badge leads there. -->
								<a
									class="from-bank"
									href={row.bankTransactionId
										? `/bank?umsatz=${row.bankTransactionId}`
										: '/bank?status=matched'}
									title="Aus einem Umsatz, dort lässt sich die Zuordnung aufheben"
									><Badge tone="info">Umsatz</Badge></a
								>
							{/if}
						</td>
						<!-- A credit stands in Haben and a refund in Soll, so neither column needs a sign. -->
						<td class="num"
							>{#if row.credit === 0}<Money cents={row.debit} />{/if}</td
						>
						<td class="num"
							>{#if row.credit > 0}<Money cents={row.credit} />{/if}</td
						>
						<td class="num"><Balance cents={row.balance} tone={false} /></td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan="2">Summe {formatMonth(data.range.from)} bis {formatMonth(data.range.to)}</td>
					<td class="num"><Money cents={data.debit} /></td>
					<td class="num"><Money cents={data.credit} /></td>
					<td class="num"><Balance cents={data.windowBalance} tone={false} label /></td>
				</tr>
			</tfoot>
		</table>
	</div>
{/if}

<h2 id="zahlungserinnerung">Zahlungserinnerung und Mahnung</h2>
{#if data.reminders.items.length === 0}
	<p class="muted">Heute ist nichts überfällig.</p>
{:else}
	<p>
		Heute überfällig: <strong><Balance cents={data.reminders.overdue} /></strong>
		{#if latest}
			<span class="muted">
				· zuletzt {reminderLevelLabels[latest.level]} vom {formatDate(latest.date)}, Frist bis
				{formatDate(latest.paymentDeadline)}
			</span>
			{#if latest.paymentDeadline < data.today}
				<Badge tone="danger">Frist abgelaufen</Badge>
			{/if}
		{/if}
	</p>
	{#if data.reminders.interest.amount > 0}
		<p>
			Verzugszinsen bis heute: <strong><Money cents={data.reminders.interest.amount} /></strong>
			<span class="muted">· {interestBasis} Ab der Mahnung nennt das Schreiben den Betrag.</span>
		</p>
	{/if}
	{#if data.reminders.baseRates.outdated}
		<Alert tone="warning">
			<p>
				Der Basiszinssatz für das laufende Halbjahr liegt noch nicht vor{baseRateError}; die
				Verzugszinsen rechnen bis dahin mit dem letzten bekannten Satz.
			</p>
		</Alert>
	{/if}
	<div class="table-wrap">
		<table class="table" aria-label="Offene Posten">
			<thead>
				<tr>
					<th>Fällig am</th>
					<th>Buchung</th>
					<th class="num">Betrag</th>
					<th class="num">Offen</th>
				</tr>
			</thead>
			<tbody>
				{#each data.reminders.items as item, index (index)}
					<tr>
						<td>{formatDate(item.dueDate)}</td>
						<td>{item.label}</td>
						<td class="num"><Money cents={item.amount} /></td>
						<td class="num"><Money cents={item.open} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<form
		method="POST"
		action="?/reminder"
		class="card"
		aria-label="Zahlungserinnerung erstellen"
		use:enhance
	>
		<Field
			label="Art des Schreibens"
			error={reminderErrors?.level}
			hint="Vorgeschlagen ist die Stufe nach dem letzten Schreiben zu diesem Rückstand. Verzug tritt bei der Miete auch ohne Mahnung ein."
		>
			<select name="level" required>
				{#each [1, 2, 3] as const as level (level)}
					<option
						value={String(level)}
						selected={(reminderValues?.level ?? String(data.reminders.suggestedLevel)) ===
							String(level)}
					>
						{reminderLevelLabels[level]}
					</option>
				{/each}
			</select>
		</Field>
		<Field
			label="Datum des Schreibens"
			error={reminderErrors?.date}
			hint="Aufgeführt wird, was an diesem Tag offen ist."
		>
			<input
				type="date"
				name="date"
				max={data.today}
				defaultValue={reminderValues?.date ?? data.today}
				aria-invalid={reminderErrors?.date ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Zahlungsfrist" error={reminderErrors?.paymentDeadline}>
			<input
				type="date"
				name="paymentDeadline"
				defaultValue={reminderValues?.paymentDeadline ?? data.paymentDeadlineDefault}
				aria-invalid={reminderErrors?.paymentDeadline ? 'true' : undefined}
				required
			/>
		</Field>
		{#if !data.landlordComplete}
			<Alert tone="warning">
				<p>
					Der Absender für das Schreiben ist unvollständig.
					<a href="/einstellungen/profil">Vermieterdaten ergänzen</a>
				</p>
			</Alert>
		{/if}
		<div class="form-actions">
			<button type="submit">Schreiben erstellen</button>
		</div>
	</form>
{/if}

{#if data.reminders.reminders.length > 0}
	<div class="table-wrap">
		<table class="table" aria-label="Erstellte Schreiben">
			<thead>
				<tr>
					<th>Datum</th>
					<th>Schreiben</th>
					<th class="num">Betrag</th>
					<th>Zahlungsfrist</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.reminders.reminders as reminder (reminder.id)}
					<tr>
						<td>
							<a href={withRange('schreiben', reminder.id)} data-sveltekit-reset="false"
								>{formatDate(reminder.date)}</a
							>
						</td>
						<td>{reminderLevelLabels[reminder.level]}</td>
						<td class="num"><Money cents={reminder.amount} /></td>
						<td>{formatDate(reminder.paymentDeadline)}</td>
						<td class="actions">
							<div class="row-actions">
								<PreviewLink
									href={reminderPdf(reminder.id)}
									text="{reminderPdf(reminder.id)}/text"
									title={reminderTitle(reminder)}
									class="button secondary small"><Icon name="file" size={14} /> Ansehen</PreviewLink
								>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Zahlung buchen</h2>
<form
	method="POST"
	action="?/payment"
	class="card"
	aria-label="Zahlung buchen"
	bind:this={paymentForm}
	use:enhance
>
	{#if data.lastPayment}
		<p class="form-wide last-payment muted small">
			<span>
				Letzte Zahlung: {formatCents(data.lastPayment.amount)} am {formatDate(
					data.lastPayment.date
				)}{data.lastPayment.note ? ` („${data.lastPayment.note}“)` : ''}
			</span>
			<button type="button" class="secondary small" onclick={repeatLastPayment}>
				Wie letzte Zahlung
			</button>
		</p>
	{/if}
	<Field label="Datum" error={paymentErrors?.date}>
		<input
			type="date"
			name="date"
			defaultValue={paymentValues?.date ?? data.today}
			aria-invalid={paymentErrors?.date ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Art" error={paymentErrors?.side}>
		{@render paymentSide(paymentValues?.side)}
	</Field>
	<Field
		label="Betrag in €"
		error={paymentErrors?.amount}
		hint="Vorbelegt mit dem offenen Saldo, sonst der Gesamtmiete."
	>
		<input
			name="amount"
			inputmode="decimal"
			defaultValue={paymentValues?.amount ?? formatCentsPlain(data.paymentDefault)}
			aria-invalid={paymentErrors?.amount ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Vermerk (optional)" error={paymentErrors?.note}>
		<input
			name="note"
			defaultValue={paymentValues?.note ?? ''}
			placeholder="z. B. Überweisung, bar erhalten"
			aria-invalid={paymentErrors?.note ? 'true' : undefined}
		/>
	</Field>
	<div class="form-actions">
		<button type="submit">Zahlung buchen</button>
	</div>
</form>

<h2>Korrektur oder Anfangssaldo</h2>
<p class="muted">
	Für Korrekturen und den Anfangssaldo. Führst du das Mietkonto erst ab einem späteren Datum
	(„Mietkonto führen ab“), buchst du den Stand an diesem Tag hier mit dem Vermerk „Anfangssaldo“:
	einen Rückstand als Forderung, ein Guthaben als Gutschrift.
</p>
<form
	method="POST"
	action="?/adjustment"
	class="card"
	aria-label="Korrektur oder Anfangssaldo"
	use:enhance
>
	<Field label="Datum" error={adjustmentErrors?.date}>
		<input
			type="date"
			name="date"
			defaultValue={adjustmentValues?.date ?? data.today}
			aria-invalid={adjustmentErrors?.date ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Art" error={adjustmentErrors?.side}>
		{@render adjustmentSide(adjustmentValues?.side)}
	</Field>
	<Field label="Betrag in €" error={adjustmentErrors?.amount}>
		<input
			name="amount"
			inputmode="decimal"
			defaultValue={adjustmentValues?.amount ?? ''}
			placeholder="z. B. 50,00"
			aria-invalid={adjustmentErrors?.amount ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Vermerk" error={adjustmentErrors?.note}>
		<input
			name="note"
			defaultValue={adjustmentValues?.note ?? ''}
			placeholder="z. B. Anfangssaldo, Mietminderung"
			aria-invalid={adjustmentErrors?.note ? 'true' : undefined}
			required
		/>
	</Field>
	<div class="form-actions">
		<button type="submit">Korrektur buchen</button>
	</div>
</form>

{#if data.editing && editValues}
	{@const payment = data.editing.kind === 'payment'}
	{#key data.editing.id}
		<EditDialog
			title={payment ? 'Zahlung bearbeiten' : 'Korrektur bearbeiten'}
			action="?/update"
			deleteAction="?/delete"
			deleteMessage="{payment ? 'Zahlung' : 'Korrektur'} vom {formatDate(
				data.editing.date
			)} über {formatCents(data.editing.amount)} löschen?"
			close={withRange()}
			error={form && 'message' in form ? form.message : undefined}
		>
			<input type="hidden" name="id" value={data.editing.id} />
			<Field label="Datum" error={editErrors?.date}>
				<input
					type="date"
					name="date"
					defaultValue={editValues.date}
					aria-invalid={editErrors?.date ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Art" error={editErrors?.side}>
				{#if payment}
					{@render paymentSide(editValues.side)}
				{:else}
					{@render adjustmentSide(editValues.side)}
				{/if}
			</Field>
			<Field label="Betrag in €" error={editErrors?.amount}>
				<input
					name="amount"
					inputmode="decimal"
					defaultValue={editValues.amount}
					aria-invalid={editErrors?.amount ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label={payment ? 'Vermerk (optional)' : 'Vermerk'} error={editErrors?.note}>
				<input
					name="note"
					defaultValue={editValues.note}
					aria-invalid={editErrors?.note ? 'true' : undefined}
					required={!payment}
				/>
			</Field>
		</EditDialog>
	{/key}
{/if}

{#if data.reminder}
	{#key data.reminder.id}
		<EditDialog
			title={reminderTitle(data.reminder)}
			deleteAction="?/deleteReminder"
			deleteMessage="{reminderTitle(
				data.reminder
			)} löschen? Das Schreiben verschwindet nur hier, nicht beim Mieter."
			close={withRange()}
			error={form && 'message' in form ? form.message : undefined}
		>
			<input type="hidden" name="id" value={data.reminder.id} />
			<dl class="details">
				<dt>Betrag</dt>
				<dd><Money cents={data.reminder.amount} /></dd>
				<dt>Zahlungsfrist</dt>
				<dd>{formatDate(data.reminder.paymentDeadline)}</dd>
				<dt>Schreiben</dt>
				<dd>
					<PreviewLink
						href={reminderPdf(data.reminder.id)}
						text="{reminderPdf(data.reminder.id)}/text"
						title={reminderTitle(data.reminder)}>Ansehen</PreviewLink
					>
				</dd>
			</dl>
		</EditDialog>
	{/key}
{/if}

{#snippet paymentSide(value: string | undefined)}
	<select name="side" required>
		<option value="received" selected={value !== 'refund'}>Zahlung erhalten (Haben)</option>
		<option value="refund" selected={value === 'refund'}>Rückzahlung (Soll)</option>
	</select>
{/snippet}

{#snippet adjustmentSide(value: string | undefined)}
	<select name="side" required>
		<option value="claim" selected={value !== 'credit'}>Forderung (Soll)</option>
		<option value="credit" selected={value === 'credit'}>Gutschrift (Haben)</option>
	</select>
{/snippet}

<style>
	.legend {
		display: block;
		font-weight: 400;
		font-size: var(--text-xs);
	}
	.from-bank {
		text-decoration: none;
	}
	.last-payment {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		margin: 0;
	}
	.balance {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 1rem;
		margin: 0 0 1rem;
	}
</style>
