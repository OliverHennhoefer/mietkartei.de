<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { depositTransactionKindLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const lease = $derived(data.lease);
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? { date: data.today, kind: 'received' });
	// Until money has come in, interest, a return or a withholding cannot happen yet.
	const kinds = $derived(
		(
			Object.entries(depositTransactionKindLabels) as [
				keyof typeof depositTransactionKindLabels,
				string
			][]
		).filter(([kind]) => kind === 'received' || data.summary.received > 0)
	);
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Kaution" tab. -->
<h2 class="visually-hidden">Kaution</h2>

{#if form?.message}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{/if}

<div class="stats" aria-label="Zusammenfassung">
	<div class="stat">
		<span class="value"><Money cents={lease.securityDeposit} /></span>
		<span class="label">Vereinbart</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.received} /></span>
		<span class="label">Erhalten</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.interest} /></span>
		<span class="label">Zinsen</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.returned} /></span>
		<span class="label">Zurückgezahlt</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.withheld} /></span>
		<span class="label">Einbehalten</span>
	</div>
	<div class="stat">
		<span class="value"><Money cents={data.summary.outstanding} /></span>
		<span class="label">Noch offen</span>
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
					<th class="num">Betrag</th>
					<th>Notiz</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.movements as movement (movement.id)}
					<tr>
						<td>{formatDate(movement.date)}</td>
						<td>{depositTransactionKindLabels[movement.kind]}</td>
						<td class="num"><Money cents={movement.amount} signed /></td>
						<td>
							{movement.note ?? ''}
							{#if movement.bankTransactionId}<Badge tone="info">aus Umsatz</Badge>{/if}
						</td>
						<td class="actions">
							{#if movement.bankTransactionId}
								<span class="muted small">
									Zuordnung beim <a href="/bank?umsatz={movement.bankTransactionId}">Umsatz</a> aufheben
								</span>
							{:else}
								<ConfirmButton
									action="?/delete"
									label="Löschen"
									message="Diese Bewegung wirklich löschen?"
									tone="secondary"
								>
									<input type="hidden" name="movementId" value={movement.id} />
								</ConfirmButton>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Bewegung buchen</h2>
<form method="POST" action="?/add" class="card form" use:enhance>
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
	<div class="form-actions">
		<button type="submit">Bewegung buchen</button>
	</div>
</form>

<style>
	.instalments {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
	}
</style>
