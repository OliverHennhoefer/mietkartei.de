<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import Alert from '#lib/components/Alert.svelte';
	import ArchiveSection from '#lib/components/ArchiveSection.svelte';
	import DocumentLink from '#lib/components/DocumentLink.svelte';
	import LeaseStatus from '#lib/components/LeaseStatus.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import DeleteSection from '#lib/components/DeleteSection.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate, formatDateTime, formatMonth } from '#lib/dates.ts';
	import { reminderLevelLabels } from '#lib/domain/reminders.ts';
	import { personName } from '#lib/format.ts';
	import { expenseCategoryLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const address = $derived(
		[data.tenant.street, [data.tenant.postalCode, data.tenant.city].filter(Boolean).join(' ')]
			.filter(Boolean)
			.join(', ')
	);
	const dossier = $derived(data.dossier);
	const finances = $derived(dossier.finances);
	const running = $derived(dossier.leases.filter((lease) => lease.active));
	const leaseLabels = $derived(new Map(dossier.leases.map((lease) => [lease.id, lease.label])));
	/** The start of the earliest lease that has begun: since when the tenant rents. */
	const tenantSince = $derived(
		dossier.leases
			.filter((lease) => !lease.upcoming)
			.map((lease) => lease.startDate)
			.sort()[0] ?? null
	);
	const currentRent = $derived(running.reduce((sum, lease) => sum + lease.rent, 0));
	const latestReminder = $derived(dossier.reminders[0]);
</script>

<PageHeader
	title={personName(data.tenant)}
	lead={[
		data.tenant.salutation,
		running.length > 0 ? `wohnt in ${running.map((lease) => lease.label).join(', ')}` : null,
		data.tenant.archivedAt ? `archiviert am ${formatDate(data.tenant.archivedAt)}` : null
	]
		.filter(Boolean)
		.join(' · ') || undefined}
	back={{ href: '/mieter', label: 'Alle Mieter' }}
>
	{#snippet actions()}
		{#if !data.tenant.archivedAt}
			<CreateButton
				href="/vertraege/neu?tenantId={data.tenant.id}"
				label="Mietvertrag anlegen"
				secondary
			/>
		{/if}
		<a href="/mieter/{data.tenant.id}/bearbeiten" class="button">Bearbeiten</a>
	{/snippet}
</PageHeader>

{#if finances.overdue > 0}
	<Alert tone="danger">
		<p>
			Rückstand <Money cents={finances.overdue} />{#if finances.openSince}
				, offen seit {formatMonth(finances.openSince)}{/if}.
			{#if latestReminder}
				Zuletzt: {reminderLevelLabels[latestReminder.level]} vom {formatDate(latestReminder.date)}.
			{/if}
		</p>
	</Alert>
{/if}

{#if dossier.leases.length > 0}
	<div class="stats" aria-label="Auf einen Blick">
		<div class="stat">
			<span class="value"><Money cents={currentRent} /></span>
			<span class="label">Warmmiete im Monat</span>
		</div>
		<div class="stat">
			<span class="value"
				><Balance
					cents={finances.overdue > 0 ? finances.overdue : finances.balance}
					overdue={finances.overdue > 0}
				/></span
			>
			<span class="label">
				{#if finances.overdue > 0}Rückstand{:else if finances.balance < 0}Guthaben des Mieters{:else if finances.balance > 0}Offen,
					noch nicht fällig{:else}Mietkonto ausgeglichen{/if}
			</span>
		</div>
		<div class="stat">
			<span class="value"><Money cents={finances.depositHeld} /></span>
			<span class="label">
				Kaution gehalten{#if finances.depositOutstanding > 0}
					· <Money cents={finances.depositOutstanding} /> noch offen{/if}
			</span>
		</div>
		<div class="stat">
			<span class="value">{tenantSince ? formatDate(tenantSince) : '–'}</span>
			<span class="label">Mieter seit</span>
		</div>
	</div>
{/if}

<h2>Kontakt</h2>
<dl class="details">
	<dt>E-Mail-Adresse</dt>
	<dd>
		{#if data.tenant.email}<a href="mailto:{data.tenant.email}">{data.tenant.email}</a>{:else}–{/if}
	</dd>
	<dt>Telefon</dt>
	<dd>
		{#if data.tenant.phone}<a href="tel:{data.tenant.phone}">{data.tenant.phone}</a>{:else}–{/if}
	</dd>
	<dt>Adresse</dt>
	<dd>{address || 'wie die gemietete Einheit'}</dd>
	{#if data.tenant.notes}
		<dt>Notizen</dt>
		<dd class="notes">{data.tenant.notes}</dd>
	{/if}
</dl>

{#if dossier.openTasks.length > 0}
	<h2>Offene Aufgaben</h2>
	<ul class="plain" aria-label="Offene Aufgaben">
		{#each dossier.openTasks as task (task.id)}
			<li>
				<a href="/aufgaben?bearbeiten={task.id}">{task.title}</a>
				{#if task.dueDate}<span class="muted"> · bis {formatDate(task.dueDate)}</span>{/if}
			</li>
		{/each}
	</ul>
{/if}

<h2>Mietverträge</h2>
{#if dossier.leases.length === 0}
	<p class="muted">Dieser Mieter steht auf keinem Mietvertrag.</p>
{:else}
	<ul class="list" aria-label="Mietverträge">
		{#each dossier.leases as lease (lease.id)}
			<li class="card lease">
				<span>
					<a href="/vertraege/{lease.id}"><strong>{lease.label}</strong></a>
					<span class="muted">
						· seit {formatDate(lease.startDate)}{#if lease.endDate}
							bis {formatDate(lease.endDate)}{/if}
					</span>
					<span class="figures muted small">
						<Money cents={lease.rent} /> warm ·
						<a href="/vertraege/{lease.id}/mietkonto"
							>Saldo <Balance cents={lease.balance} overdue={lease.overdue > 0} /></a
						>
						· Kaution <Money cents={lease.depositHeld} />
						{#if lease.depositAgreed > 0}von <Money cents={lease.depositAgreed} />{/if}
					</span>
				</span>
				<LeaseStatus status={lease.active ? 'active' : lease.upcoming ? 'upcoming' : 'ended'} />
			</li>
		{/each}
	</ul>
{/if}

{#if dossier.leases.length > 0}
	<h2>Finanzen</h2>
	<p class="muted">Über die ganze Mietzeit und alle Mietverträge dieses Mieters.</p>
	<dl class="details" aria-label="Finanzen">
		<dt>Gezahlt</dt>
		<dd><Money cents={finances.paid} /></dd>
		<dt>Gefordert</dt>
		<dd>
			<Money cents={finances.charged} />
			<span class="muted small">Miete, Abrechnungen, Korrekturen</span>
		</dd>
		<dt>Saldo</dt>
		<dd>
			<Balance cents={finances.balance} overdue={finances.overdue > 0} label />
		</dd>
		<dt>Letzte Zahlung</dt>
		<dd>{finances.lastPaymentDate ? formatDate(finances.lastPaymentDate) : '–'}</dd>
		<dt>Nebenkostenabrechnungen</dt>
		<dd>
			{#if dossier.statements.length === 0}–{:else}
				<Money cents={Math.abs(finances.statementBalance)} />
				<span class="muted small">
					{finances.statementBalance >= 0 ? 'Nachzahlungen' : 'Guthaben'} aus {dossier.statements
						.length}
					{dossier.statements.length === 1 ? 'Abrechnung' : 'Abrechnungen'}
				</span>
			{/if}
		</dd>
		<dt>Kosten an der Einheit</dt>
		<dd>
			<Money cents={finances.unitCosts} />
			<span class="muted small">Ausgaben auf der Einheit während der Mietzeit</span>
		</dd>
		<dt>Gezahlt abzüglich Kosten</dt>
		<dd><Money cents={finances.net} signed /></dd>
	</dl>

	<div class="columns">
		<section aria-labelledby="zahlungen">
			<h3 id="zahlungen">Letzte Zahlungen</h3>
			{#if dossier.payments.length === 0}
				<p class="muted">Noch keine Zahlung gebucht.</p>
			{:else}
				<table class="table" aria-label="Letzte Zahlungen">
					<tbody>
						{#each dossier.payments as payment (payment.id)}
							<tr>
								<td>{formatDate(payment.date)}</td>
								<td>
									{payment.note || (payment.amount < 0 ? 'Rückzahlung' : 'Zahlung')}
									{#if dossier.leases.length > 1}
										<span class="muted small"> · {leaseLabels.get(payment.leaseId)}</span>
									{/if}
								</td>
								<td class="num"><Money cents={payment.amount} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section aria-labelledby="abrechnungen">
			<h3 id="abrechnungen">Nebenkostenabrechnungen</h3>
			{#if dossier.statements.length === 0}
				<p class="muted">Noch keine freigegebene Abrechnung.</p>
			{:else}
				<table class="table" aria-label="Nebenkostenabrechnungen">
					<tbody>
						{#each dossier.statements as statement (statement.statementId + statement.leaseId)}
							<tr>
								<td>
									{#if statement.statementId}
										<a href="/betriebskosten/abrechnungen/{statement.statementId}"
											>{statement.label}</a
										>
									{:else}{statement.label}{/if}
								</td>
								<td class="num">
									<Money cents={Math.abs(statement.amount)} />
									<span class="muted small"
										>{statement.amount > 0
											? 'Nachzahlung'
											: statement.amount < 0
												? 'Guthaben'
												: 'nichts zu zahlen'}</span
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section aria-labelledby="kosten">
			<h3 id="kosten">Kosten an der Einheit</h3>
			{#if dossier.unitCosts.length === 0}
				<p class="muted">Keine Ausgabe auf der Einheit während der Mietzeit.</p>
			{:else}
				<table class="table" aria-label="Kosten an der Einheit">
					<tbody>
						{#each dossier.unitCosts as expense (expense.id)}
							<tr>
								<td>{formatDate(expense.date)}</td>
								<td>
									{expense.description}
									<span class="muted small"> · {expenseCategoryLabels[expense.category]}</span>
								</td>
								<td class="num"><Money cents={expense.amount} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		{#if dossier.reminders.length > 0}
			<section aria-labelledby="mahnungen">
				<h3 id="mahnungen">Erinnerungen und Mahnungen</h3>
				<table class="table" aria-label="Erinnerungen und Mahnungen">
					<tbody>
						{#each dossier.reminders as reminder (reminder.id)}
							<tr>
								<td>{formatDate(reminder.date)}</td>
								<td>
									<a href="/vertraege/{reminder.leaseId}/mietkonto#zahlungserinnerung"
										>{reminderLevelLabels[reminder.level]}</a
									>
								</td>
								<td class="num"><Money cents={reminder.amount} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}
	</div>
{/if}

<h2>Dokumente</h2>
{#if dossier.documents.length === 0}
	<p class="muted">Noch kein Dokument zu diesem Mieter oder seinen Mietverträgen.</p>
{:else}
	<ul class="plain" aria-label="Dokumente">
		{#each dossier.documents as document (document.id)}
			<li>
				<DocumentLink {document} />
				<span class="muted small"> · {formatDateTime(document.createdAt)}</span>
			</li>
		{/each}
	</ul>
{/if}
<p>
	<a href="/dokumente?tenantId={data.tenant.id}">Dokumente dieses Mieters</a>
</p>

<h2>Verlauf</h2>
{#if dossier.history.length === 0}
	<p class="muted">Noch keine Einträge.</p>
{:else}
	<ul class="plain history" aria-label="Verlauf">
		{#each dossier.history as entry (entry.id)}
			<li>
				<span class="muted small">{formatDateTime(entry.at)}</span>
				{entry.summary}
				{#if entry.userName}<span class="muted small"> · {entry.userName}</span>{/if}
			</li>
		{/each}
	</ul>
{/if}

<ArchiveSection
	heading="Archivieren"
	label="Mieter archivieren"
	question="Mieter {personName(
		data.tenant
	)} archivieren? Du kannst ihn jederzeit aus dem Archiv holen."
	text="Für einen ausgezogenen Mieter: Er verschwindet aus der Mieterliste und den Auswahlfeldern, neue Mietverträge mit ihm sind nicht mehr möglich. Mietverträge, Mietkonto, Abrechnungen und Dokumente bleiben erhalten."
	check={data.archiving}
	error={form?.archiveError}
/>

<DeleteSection
	heading="Löschen"
	label="Mieter löschen"
	question="Mieter {personName(data.tenant)} löschen?"
	check={data.deletion}
	alternative="Ist der Mieter ausgezogen, archiviere ihn stattdessen: Die Historie bleibt, und er verschwindet aus Listen und Auswahlfeldern."
	error={form?.deleteError}
/>

<style>
	.notes {
		white-space: pre-line;
	}
	.lease .figures {
		display: block;
		margin-top: 0.25rem;
	}
	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
		gap: 1rem 2rem;
	}
	.plain {
		display: grid;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0;
		list-style: none;
	}
	.history li {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		align-items: baseline;
	}
</style>
