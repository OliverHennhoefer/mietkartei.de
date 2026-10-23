<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
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
	const reminderErrors = $derived(failed?.form === 'reminder' ? failed.errors : undefined);
	const reminderValues = $derived(failed?.form === 'reminder' ? failed.values : undefined);

	const deletedMessages = {
		payment: 'Zahlung gelöscht.',
		adjustment: 'Korrektur gelöscht.',
		reminder: 'Schreiben gelöscht.'
	};
	const reminderPdf = (id: string) => `/vertraege/${data.lease.id}/mietkonto/schreiben/${id}`;
	const latest = $derived(data.reminders.current[0]);
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Mietkonto" tab. -->
<h2>Mietkonto</h2>

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
{:else if form?.deleted}
	<Alert tone="success">
		<p>{deletedMessages[form.deleted]}</p>
	</Alert>
{:else if form?.reminderId}
	<Alert tone="success">
		<p>
			Schreiben erstellt. <a href={reminderPdf(form.reminderId)}>PDF herunterladen</a>
		</p>
	</Alert>
{/if}

<p class="balance">
	<strong>Saldo: {data.balanceText}</strong>
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
					<th class="num">Saldo</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr>
						<td>{formatDate(row.date)}</td>
						<td>
							{row.label}
							{#if row.fromBank}
								<Badge tone="info">Umsatz</Badge>
							{/if}
						</td>
						<td class="num"
							>{#if row.kind === 'charge'}<Money cents={row.amount} />{/if}</td
						>
						<td class="num"
							>{#if row.kind === 'payment'}<Money cents={row.amount} />{/if}</td
						>
						<td class="num"><Money cents={row.balance} /></td>
						<td class="actions">
							{#if row.fromBank}
								<span class="muted small">
									Zuordnung beim <a
										href={row.bankTransactionId
											? `/bank?umsatz=${row.bankTransactionId}`
											: '/bank?status=matched'}>Umsatz</a
									> aufheben
								</span>
							{:else if row.deletable && row.kind === 'payment'}
								<ConfirmButton
									action="?/deletePayment"
									label="Löschen"
									message="Zahlung vom {formatDate(row.date)} über {formatCents(
										row.amount
									)} löschen?"
								>
									<input type="hidden" name="id" value={row.id} />
								</ConfirmButton>
							{:else if row.deletable}
								<ConfirmButton
									action="?/deleteCharge"
									label="Löschen"
									message="Buchung „{row.label}“ über {formatCents(row.amount)} löschen?"
								>
									<input type="hidden" name="id" value={row.id} />
								</ConfirmButton>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan="2">Summe {formatMonth(data.range.from)} bis {formatMonth(data.range.to)}</td>
					<td class="num"><Money cents={data.charged} /></td>
					<td class="num"><Money cents={data.paid} /></td>
					<td class="num"><Money cents={data.windowBalance} /></td>
					<td></td>
				</tr>
			</tfoot>
		</table>
	</div>
	<p class="muted small">Saldo positiv = Rückstand, negativ = Guthaben.</p>
{/if}

<h2 id="zahlungserinnerung">Zahlungserinnerung und Mahnung</h2>
{#if data.reminders.items.length === 0}
	<p class="muted">Heute ist nichts überfällig.</p>
{:else}
	<p>
		Heute überfällig: <strong><Money cents={data.reminders.overdue} /></strong>
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
						<td>{formatDate(reminder.date)}</td>
						<td>{reminderLevelLabels[reminder.level]}</td>
						<td class="num"><Money cents={reminder.amount} /></td>
						<td>{formatDate(reminder.paymentDeadline)}</td>
						<td class="actions">
							<a href={reminderPdf(reminder.id)}>PDF</a>
							<ConfirmButton
								action="?/deleteReminder"
								label="Löschen"
								message="{reminderLevelLabels[reminder.level]} vom {formatDate(
									reminder.date
								)} löschen? Das Schreiben verschwindet nur hier, nicht beim Mieter."
							>
								<input type="hidden" name="id" value={reminder.id} />
							</ConfirmButton>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Zahlung buchen</h2>
<form method="POST" action="?/payment" class="card" aria-label="Zahlung buchen" use:enhance>
	<Field label="Datum" error={paymentErrors?.date}>
		<input
			type="date"
			name="date"
			defaultValue={paymentValues?.date ?? data.today}
			aria-invalid={paymentErrors?.date ? 'true' : undefined}
			required
		/>
	</Field>
	<Field
		label="Betrag in €"
		error={paymentErrors?.amount}
		hint="Vorbelegt mit dem offenen Saldo, sonst der Gesamtmiete. Negativ für eine Rückzahlung an den Mieter."
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
	einen Rückstand positiv, ein Guthaben negativ.
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
	<Field
		label="Betrag in €"
		error={adjustmentErrors?.amount}
		hint="Positiv = Forderung an den Mieter, negativ = Gutschrift."
	>
		<input
			name="amount"
			inputmode="decimal"
			defaultValue={adjustmentValues?.amount ?? ''}
			placeholder="z. B. -50,00"
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

<style>
	.balance {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 1rem;
		margin: 0 0 1rem;
	}
</style>
