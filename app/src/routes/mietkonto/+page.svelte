<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LeaseStatus from '#lib/components/LeaseStatus.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { formatCents } from '#lib/money.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The row whose "Miete ist da" is being booked; every button waits until it is done. */
	let pending = $state<string | null>(null);

	// Short enough that the letter and its deadline fit on one line: „Mahnung 14.09. · Frist abgelaufen“.
	const levelLabels = { 1: 'Erinnerung', 2: 'Mahnung', 3: 'Letzte Mahnung' };
	const dayMonth = (date: string) => formatDate(date).slice(0, 6);
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
		<div class="stat">
			<span class="value"><Balance cents={data.stats.arrearsTotal} /></span>
			<span class="label">
				Rückstände · {pluralize(data.stats.arrearsCount, 'Mietvertrag', 'Mietverträge')}
			</span>
		</div>
		<div class="stat">
			<span class="value"><Balance cents={-data.stats.creditTotal} /></span>
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
									<span class="ended"><LeaseStatus status="ended" /></span>
								{/if}
							</td>
							<td>{row.tenants}</td>
							<td class="num">
								<!-- The sign of the balance and the Rückstand are separate: a payment dated later can
								     turn the balance into a Guthaben while rent due today is still unpaid. -->
								<Balance cents={row.balance} overdue={row.overdue > 0} />
								{#if row.balance > 0 && row.overdue === 0}
									<span class="muted small due">noch nicht fällig</span>
								{:else if row.overdue > 0 && row.overdue !== row.balance}
									<span class="muted small due">
										{row.overdue < row.balance ? 'davon fällig' : 'fällig'}
										<Balance cents={row.overdue} />
									</span>
								{/if}
							</td>
							<td>
								{#if row.openSince}{formatMonth(row.openSince)}{:else}–{/if}
							</td>
							<td>{row.lastPaymentDate ? formatDate(row.lastPaymentDate) : '–'}</td>
							<td>
								{#if row.reminder}
									{@const expired = row.reminder.paymentDeadline < data.today}
									<!-- One line where the table has room; on a narrower screen the deadline wraps as a whole. -->
									<span class="reminder" class:expired>
										<span
											>{#if expired}<Icon name="alert" size={13} />{/if}
											{levelLabels[row.reminder.level]}
											{dayMonth(row.reminder.date)} <span class="separator">·</span></span
										>
										<span
											>{expired
												? 'Frist abgelaufen'
												: `Frist bis ${dayMonth(row.reminder.paymentDeadline)}`}</span
										>
									</span>
								{:else if row.overdue > 0}
									<span class="muted">noch nicht</span>
								{:else}
									–
								{/if}
							</td>
							<td class="actions">
								<div class="row-actions">
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
												class="small secondary"
												disabled={pending !== null}
												title="Bucht {formatCents(
													row.rentReceived
												)} mit Datum von heute als Zahlung"
											>
												<Icon name="check" size={14} />
												Miete ist da · {formatCents(row.rentReceived)}
											</button>
										</form>
									{/if}
									{#if row.overdue > 0}
										<a
											class="button secondary small"
											href="/vertraege/{row.leaseId}/mietkonto#zahlungserinnerung"
										>
											{row.reminder ? 'Mahnen' : 'Erinnern'}
										</a>
									{/if}
									<!-- The name in the first column leads there too; the arrow is for the eye. -->
									<a
										class="open"
										href="/vertraege/{row.leaseId}/mietkonto"
										aria-label="Mietkonto öffnen"
										title="Mietkonto öffnen"
									>
										<Icon name="chevron-right" size={18} />
									</a>
								</div>
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
	.ended {
		margin-left: 0.4rem;
	}
	.ended :global(.lease-status) {
		font-size: var(--text-xs);
	}
	.reminder > span {
		white-space: nowrap;
	}
	.reminder :global(svg) {
		margin-right: 0.15rem;
		vertical-align: -0.1em;
	}
	.reminder.expired {
		color: var(--color-danger);
		font-weight: 500;
	}
	.separator {
		color: var(--color-muted);
	}
	/* Seven columns: narrower gutters than other tables, so the row fits a laptop screen. */
	@media (min-width: 40.0625rem) {
		.table th,
		.table td {
			padding-inline: 0.7rem;
		}
		.table th:first-child,
		.table td:first-child {
			padding-left: 1.25rem;
		}
		.table th:last-child,
		.table td:last-child {
			padding-right: 1rem;
		}
	}
	/* Side by side; only where even that does not fit (a small laptop) do the buttons wrap. */
	td.actions {
		white-space: normal;
	}
	@media (max-width: 75rem) {
		.row-actions {
			flex-wrap: wrap;
		}
	}
	.open {
		display: inline-grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		color: var(--color-muted);
	}
	.open:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}
	.toolbar a[aria-current='page'] {
		font-weight: 600;
		text-decoration: none;
	}
</style>
