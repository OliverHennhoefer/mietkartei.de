<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { reminderLevelLabels } from '#lib/domain/reminders.ts';
	import { formatCents } from '#lib/money.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The row whose "Miete ist da" is being booked; every button waits until it is done. */
	let pending = $state<string | null>(null);
</script>

<PageHeader
	title="Mietkonto"
	lead="Alle Mietverträge mit ihrem Saldo. Rückstände stehen oben, mit dem letzten Schreiben dazu."
/>

{#if data.leaseCount === 0}
	<EmptyState
		title="Noch kein Mietvertrag"
		text="Das Mietkonto entsteht mit dem ersten Mietvertrag: Sollstellungen Monat für Monat, Zahlungen dagegen."
	>
		<a class="button" href="/vertraege">Zu den Mietverträgen</a>
	</EmptyState>
{:else}
	<div class="stats">
		<div class="stat card">
			<span class="value"><Money cents={data.stats.arrearsTotal} /></span>
			<span class="label">
				Rückstände · {pluralize(data.stats.arrearsCount, 'Mietvertrag', 'Mietverträge')}
			</span>
		</div>
		<div class="stat card">
			<span class="value"><Money cents={data.stats.creditTotal} /></span>
			<span class="label">
				Guthaben · {pluralize(data.stats.creditCount, 'Mietvertrag', 'Mietverträge')}
			</span>
		</div>
	</div>

	{#if form && 'message' in form}
		<Alert tone="danger"><p>{form.message}</p></Alert>
	{:else if form?.received}
		<Alert tone="success">
			<p>
				Zahlung über {formatCents(form.received.amount)} für {form.received.label} gebucht.
				<a href="/vertraege/{form.received.leaseId}/mietkonto">Im Mietkonto ansehen</a>
			</p>
		</Alert>
	{/if}

	<nav class="toolbar" aria-label="Filter">
		<a href="/mietkonto" aria-current={data.onlyArrears ? undefined : 'page'}>Alle</a>
		<a href="/mietkonto?filter=rueckstaende" aria-current={data.onlyArrears ? 'page' : undefined}>
			nur Rückstände
		</a>
	</nav>

	{#if data.rows.length === 0}
		<p class="muted">Kein Mietvertrag ist im Rückstand.</p>
	{:else}
		<div class="table-wrap">
			<table class="table" aria-label="Salden">
				<thead>
					<tr>
						<th>Mietvertrag</th>
						<th>Mieter</th>
						<th class="num">Saldo</th>
						<th>Offen seit</th>
						<th>Letzte Zahlung</th>
						<th>Erinnert</th>
						<th class="actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.leaseId)}
						<tr>
							<td>
								<a href="/vertraege/{row.leaseId}/mietkonto">{row.label}</a>
								{#if !row.active}
									<Badge>beendet</Badge>
								{/if}
							</td>
							<td>{row.tenants}</td>
							<td class="num">
								<!-- The sign of the balance and the Rückstand are separate: a payment dated later can
								     turn the balance into a Guthaben while rent due today is still unpaid. -->
								<Money cents={Math.abs(row.balance)} />
								{#if row.balance > 0}
									{#if row.overdue > 0}
										<Badge tone="danger">Rückstand</Badge>
									{:else}
										<Badge>noch nicht fällig</Badge>
									{/if}
								{:else if row.balance < 0}
									<Badge tone="success">Guthaben</Badge>
								{/if}
								{#if row.overdue > 0 && row.overdue !== row.balance}
									<span class="muted small due">
										{#if row.balance <= 0}
											<Badge tone="danger">Rückstand</Badge>
										{/if}
										{row.overdue < row.balance ? 'davon fällig' : 'fällig'}
										<Money cents={row.overdue} />
									</span>
								{/if}
							</td>
							<td>
								{#if row.openSince}{formatMonth(row.openSince)}{:else}–{/if}
							</td>
							<td>{row.lastPaymentDate ? formatDate(row.lastPaymentDate) : '–'}</td>
							<td>
								{#if row.reminder}
									{reminderLevelLabels[row.reminder.level]} vom {formatDate(row.reminder.date)}
									{#if row.reminder.paymentDeadline < data.today}
										<Badge tone="danger">Frist abgelaufen</Badge>
									{:else}
										<span class="muted small due">
											Frist bis {formatDate(row.reminder.paymentDeadline)}
										</span>
									{/if}
								{:else if row.overdue > 0}
									<span class="muted">noch nicht</span>
								{:else}
									–
								{/if}
							</td>
							<td class="actions">
								{#if row.rentReceived}
									<form
										method="POST"
										action="?/received"
										use:enhance={() => {
											pending = row.leaseId;
											return async ({ update }) => {
												try {
													await update();
												} finally {
													pending = null;
												}
											};
										}}
									>
										<input type="hidden" name="leaseId" value={row.leaseId} />
										<button
											type="submit"
											class="small"
											disabled={pending !== null}
											title="Bucht {formatCents(row.rentReceived)} mit Datum von heute als Zahlung"
										>
											Miete ist da · {formatCents(row.rentReceived)}
										</button>
									</form>
								{/if}
								{#if row.overdue > 0}
									<a href="/vertraege/{row.leaseId}/mietkonto#zahlungserinnerung">
										{row.reminder ? 'Mahnen' : 'Erinnern'}
									</a>
								{/if}
								<a href="/vertraege/{row.leaseId}/mietkonto">Mietkonto</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

<style>
	.due {
		display: block;
	}
	.toolbar a[aria-current='page'] {
		font-weight: 600;
		text-decoration: none;
	}
</style>
