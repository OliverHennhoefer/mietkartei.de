<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { depositTransactionKindLabels } from '#lib/labels.ts';
	import { formatCents, formatCentsPlain } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const lease = $derived(data.lease);
	// A refused edit belongs to the edit dialog, everything else to the form below the table.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived((!editRefused && form?.errors) || {});
	const values = $derived((!editRefused && form?.values) || { date: data.today, kind: 'received' });
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
					<th>Datum</th>
					<th>Art</th>
					<th class="num">Eingang</th>
					<th class="num">Ausgang</th>
					<th class="num">Bestand</th>
					<th>Notiz</th>
				</tr>
			</thead>
			<tbody>
				{#each movements as movement (movement.id)}
					<tr>
						<td>
							{#if movement.bankTransactionId}
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
	.instalments {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
	}
</style>
