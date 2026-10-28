<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Money from '#lib/components/Money.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { depositTransactionKindLabels } from '#lib/labels.ts';
	import { formatCents, formatCentsPlain, parseCents } from '#lib/money.ts';
	import { byDate, byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const lease = $derived(data.lease);
	// A refused edit belongs to the edit dialog, a refused settlement to its form, everything else
	// to the form below the table.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const settleRefused = $derived(form && 'settle' in form ? form : undefined);
	const errors = $derived((!editRefused && !settleRefused && form?.errors) || {});
	const values = $derived(
		(!editRefused && !settleRefused && form?.values) || { date: data.today, kind: 'received' }
	);
	const settleErrors = $derived<Partial<Record<string, string>>>(settleRefused?.errors ?? {});
	const settleValues = $derived<Record<string, string>>(
		settleRefused?.values ?? { date: data.today, offsetArrears: data.arrears > 0 ? 'on' : '' }
	);

	// The Einbehalte of the settlement form: as many rows as were sent back, at least one.
	const sentRows = $derived(
		Array.from({ length: data.maxDeductions }, (_, index) => index + 1).filter(
			(row) => settleValues[`label${row}`] || settleValues[`amount${row}`]
		).length
	);
	let addedRows = $state(0);
	const rows = $derived(Math.min(data.maxDeductions, Math.max(1, sentRows) + addedRows));
	// The preview of the payout, from the fields as typed.
	let interestInput = $state('');
	let amountInputs = $state<string[]>([]);
	let offsetArrears = $state(true);
	$effect.pre(() => {
		interestInput = settleValues.interest ?? '';
		amountInputs = Array.from(
			{ length: data.maxDeductions },
			(_, index) => settleValues[`amount${index + 1}`] ?? ''
		);
		offsetArrears = settleValues.offsetArrears === 'on';
	});
	const cents = (input: string) => (input.trim() ? (parseCents(input) ?? 0) : 0);
	const preview = $derived.by(() => {
		const available = data.summary.held + cents(interestInput);
		const deducted = amountInputs.slice(0, rows).reduce((sum, input) => sum + cents(input), 0);
		const offset = offsetArrears ? Math.min(data.arrears, Math.max(0, available - deducted)) : 0;
		return { available, deducted, offset, payout: available - deducted - offset };
	});
	const settlementPdf = $derived(`/vertraege/${data.lease.id}/kaution/abrechnung`);
	const editValues = $derived(
		editRefused?.values ??
			(data.editing && {
				date: data.editing.date,
				kind: data.editing.kind,
				amount: formatCentsPlain(Math.abs(data.editing.amount)),
				note: data.editing.note ?? ''
			})
	);
	// Until money has come in, interest, a return or a withholding cannot happen yet; a movement
	// being edited keeps its own kind.
	const kindsFor = (current?: string) =>
		(
			Object.entries(depositTransactionKindLabels) as [
				keyof typeof depositTransactionKindLabels,
				string
			][]
		).filter(([kind]) => kind === 'received' || kind === current || data.summary.received > 0);

	/** The movements, oldest first, each with the Bestand after it. */
	const movements = $derived.by(() => {
		let held = 0;
		return data.movements.map((movement) => ({ ...movement, held: (held += movement.amount) }));
	});
	const sort = new TableSort<(typeof movements)[number]>({
		date: byDate((movement) => movement.date),
		kind: byText((movement) => depositTransactionKindLabels[movement.kind]),
		received: byNumber((movement) => (movement.amount >= 0 ? movement.amount : null)),
		paid: byNumber((movement) => (movement.amount < 0 ? -movement.amount : null)),
		held: byNumber((movement) => movement.held),
		note: byText((movement) => movement.note)
	});
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Kaution" tab. -->
<h2 class="visually-hidden">Kaution</h2>

{#if form?.message}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{/if}

<!-- Three figures in one row: what was agreed, what the landlord holds for the tenant today and
     what the tenant still has to pay in. The movements below show how the Bestand came about. -->
<div class="stats" aria-label="Zusammenfassung">
	<div class="stat">
		<span class="value"><Money cents={lease.securityDeposit} /></span>
		<span class="label">Vereinbart</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.held} /></span>
		<span class="label">Bestand heute</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.outstanding} /></span>
		<span class="label">Noch offen vom Mieter</span>
	</div>
</div>

{#if data.instalments.length > 0}
	<h2>Raten</h2>
	<p class="muted small">
		Nach § 551 Abs. 2 BGB darf der Mieter die Kaution in drei Raten zahlen: die erste zu Beginn des
		Mietverhältnisses, die beiden anderen mit den folgenden Mieten.
	</p>
	<ul class="instalments" aria-label="Raten">
		{#each data.instalments as instalment, index (instalment.dueDate)}
			<li>
				{index + 1}. Rate <Money cents={instalment.amount} /> bis {formatDate(instalment.dueDate)}
			</li>
		{/each}
	</ul>
{/if}

<h2>Bewegungen</h2>
{#if data.movements.length === 0}
	<p class="muted">Noch keine Bewegungen.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Kautionsbewegungen">
			<thead>
				<tr>
					<SortHeader {sort} key="date">Datum</SortHeader>
					<SortHeader {sort} key="kind">Art</SortHeader>
					<SortHeader {sort} key="received" class="num">Eingang</SortHeader>
					<SortHeader {sort} key="paid" class="num">Ausgang</SortHeader>
					<SortHeader {sort} key="held" class="num">Bestand</SortHeader>
					<SortHeader {sort} key="note">Notiz</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(movements) as movement (movement.id)}
					<tr>
						<td>
							{#if movement.bankTransactionId || movement.settlementId}
								{formatDate(movement.date)}
							{:else}
								<a href="?bearbeiten={movement.id}" data-sveltekit-reset="false"
									>{formatDate(movement.date)}</a
								>
							{/if}
						</td>
						<td>{depositTransactionKindLabels[movement.kind]}</td>
						<td class="num"
							>{#if movement.amount >= 0}<Money cents={movement.amount} />{/if}</td
						>
						<td class="num"
							>{#if movement.amount < 0}<Money cents={-movement.amount} />{/if}</td
						>
						<td class="num"><Money cents={movement.held} /></td>
						<td>
							{movement.note ?? ''}
							{#if movement.bankTransactionId}
								<!-- Changed or undone at the bank transaction, so the badge leads there. -->
								<a
									class="from-bank"
									href="/bank?umsatz={movement.bankTransactionId}"
									title="Aus einem Umsatz, dort lässt sich die Zuordnung aufheben"
									><Badge tone="info">Umsatz</Badge></a
								>
							{/if}
							{#if movement.settlementId}
								<Badge tone="neutral">Abrechnung</Badge>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
			{#if movements.length > 1}
				<tfoot>
					<tr>
						<td colspan="2">Summe</td>
						<td class="num"><Money cents={data.summary.received + data.summary.interest} /></td>
						<td class="num"><Money cents={data.summary.returned + data.summary.withheld} /></td>
						<td class="num"><Money cents={data.summary.held} /></td>
						<td></td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
{/if}

{#if data.settlement}
	<h2>Kautionsabrechnung</h2>
	<div class="card settlement">
		<p>
			Abgerechnet am {formatDate(data.settlement.date)}: Auszahlung an den Mieter
			<strong><Money cents={data.settlement.payout} /></strong>{#if data.settlement.remaining > 0},
				danach bleibt ein Mietrückstand von <Money cents={data.settlement.remaining} />{/if}.
		</p>
		<div class="actions">
			<PreviewLink
				href={settlementPdf}
				text="{settlementPdf}/text"
				title="Kautionsabrechnung vom {formatDate(data.settlement.date)}"
				class="button secondary"><Icon name="file" size={14} /> Schreiben ansehen</PreviewLink
			>
			<ConfirmButton
				action="?/deleteSettlement"
				label="Abrechnung löschen"
				message="Kautionsabrechnung vom {formatDate(
					data.settlement.date
				)} löschen? Ihre Buchungen auf der Kaution und dem Mietkonto werden mit gelöscht."
			/>
		</div>
	</div>
{:else if data.settleable}
	<h2>Kautionsabrechnung</h2>
	<p class="muted small">
		Nach dem Auszug rechnest du über die Kaution ab: Zinsen kommen hinzu, Einbehalte für Schäden
		oder eine noch ausstehende Betriebskostenabrechnung gehen mit ihrem Grund ab, ein Mietrückstand
		lässt sich verrechnen. Den Rest zahlst du zurück. Üblich sind dafür bis zu sechs Monate nach dem
		Vertragsende.
	</p>
	{#if form?.settled}
		<Alert tone="success"><p>Die Kaution ist abgerechnet.</p></Alert>
	{/if}
	{#if settleRefused?.message}
		<Alert tone="danger"><p>{settleRefused.message}</p></Alert>
	{/if}
	<form method="POST" action="?/settle" class="card form" use:enhance>
		<Field label="Datum der Abrechnung" error={settleErrors.date}>
			<input
				name="date"
				type="date"
				defaultValue={settleValues.date ?? ''}
				max={data.today}
				aria-invalid={settleErrors.date ? 'true' : undefined}
				required
			/>
		</Field>
		<Field
			label="Zinsen bis heute (optional)"
			error={settleErrors.interest}
			hint="Zinsen, die noch nicht als Bewegung gebucht sind (§ 551 Abs. 3 BGB)."
		>
			<input
				name="interest"
				bind:value={interestInput}
				inputmode="decimal"
				placeholder="0,00"
				aria-invalid={settleErrors.interest ? 'true' : undefined}
			/>
		</Field>
		<fieldset class="deductions form-wide">
			<legend>Einbehalte</legend>
			{#each Array.from({ length: rows }, (_, index) => index + 1) as row (row)}
				<div class="deduction">
					<Field label="Grund" error={settleErrors[`label${row}`]}>
						<input
							name="label{row}"
							defaultValue={settleValues[`label${row}`] ?? ''}
							placeholder="z. B. Reparatur der Badtür laut Übergabeprotokoll"
							aria-invalid={settleErrors[`label${row}`] ? 'true' : undefined}
						/>
					</Field>
					<Field label="Betrag" error={settleErrors[`amount${row}`]}>
						<input
							name="amount{row}"
							bind:value={amountInputs[row - 1]}
							inputmode="decimal"
							placeholder="0,00"
							aria-invalid={settleErrors[`amount${row}`] ? 'true' : undefined}
						/>
					</Field>
				</div>
			{/each}
			{#if rows < data.maxDeductions}
				<button type="button" class="secondary small" onclick={() => (addedRows += 1)}
					>Weiterer Einbehalt</button
				>
			{/if}
		</fieldset>
		{#if data.arrears > 0}
			<label class="inline form-wide">
				<input type="checkbox" name="offsetArrears" bind:checked={offsetArrears} />
				Mietrückstand von {formatCents(data.arrears)} mit der Kaution verrechnen
			</label>
		{/if}
		<p class="preview form-wide" aria-live="polite">
			Kaution <Money cents={preview.available} />
			{#if preview.deducted > 0}− Einbehalte <Money cents={preview.deducted} />{/if}
			{#if preview.offset > 0}− Rückstand <Money cents={preview.offset} />{/if}
			= Auszahlung <strong><Money cents={preview.payout} /></strong>
		</p>
		<div class="form-actions">
			<button type="submit">Kaution abrechnen</button>
		</div>
	</form>
{/if}

<h2>Bewegung buchen</h2>
<form method="POST" action="?/add" class="card form" use:enhance>
	{@render movementFields(values, errors, kindsFor())}
	<div class="form-actions">
		<button type="submit">Bewegung buchen</button>
	</div>
</form>

{#snippet movementFields(
	values: Record<string, string>,
	errors: Partial<Record<string, string>>,
	kinds: ReturnType<typeof kindsFor>
)}
	<Field label="Datum" error={errors.date}>
		<input
			name="date"
			type="date"
			defaultValue={values.date ?? ''}
			aria-invalid={errors.date ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Art" error={errors.kind}>
		<select name="kind" aria-invalid={errors.kind ? 'true' : undefined} required>
			{#each kinds as [kind, label] (kind)}
				<option value={kind} selected={values.kind === kind}>{label}</option>
			{/each}
		</select>
	</Field>
	<Field
		label="Betrag"
		error={errors.amount}
		hint="Immer ohne Vorzeichen; die Art bestimmt die Richtung."
	>
		<input
			name="amount"
			defaultValue={values.amount ?? ''}
			inputmode="decimal"
			placeholder="600,00"
			aria-invalid={errors.amount ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Notiz (optional)" error={errors.note}>
		<input name="note" defaultValue={values.note ?? ''} />
	</Field>
{/snippet}

{#if data.editing && editValues}
	{#key data.editing.id}
		<EditDialog
			title="Bewegung bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage="{depositTransactionKindLabels[data.editing.kind]} über {formatCents(
				Math.abs(data.editing.amount)
			)} vom {formatDate(data.editing.date)} löschen?"
			close="/vertraege/{data.lease.id}/kaution"
			error={form?.message}
		>
			<input type="hidden" name="movementId" value={data.editing.id} />
			{@render movementFields(editValues, editRefused?.errors ?? {}, kindsFor(data.editing.kind))}
		</EditDialog>
	{/key}
{/if}

<style>
	.from-bank {
		text-decoration: none;
	}
	.settlement .actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.deductions {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.deductions legend {
		padding: 0;
		font-weight: 600;
	}
	.deduction {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
		gap: 0.75rem;
	}
	@media (max-width: 40rem) {
		.deduction {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.preview {
		margin: 0.5rem 0 0;
	}
	.instalments {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
	}
</style>
