<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { reminderLevelLabels } from '#lib/domain/reminders.ts';
	import { formatNumber, personName, pluralize } from '#lib/format.ts';
	import { formatCents } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let search = $state('');
	// Matches name, address and the active leases (unit and property), so typing a property's name
	// also works as a property filter.
	const filteredTenants = $derived(
		data.tenants.filter((tenant) =>
			[
				personName(tenant),
				tenant.email,
				address(tenant),
				...tenant.activeLeases.map((lease) => lease.label)
			]
				.join(' ')
				.toLocaleLowerCase('de')
				.includes(search.trim().toLocaleLowerCase('de'))
		)
	);
	const overview = $derived(data.overview);
	const summary = $derived(
		[
			`${pluralize(overview.renting, 'Mieter', 'Mieter')} in ${pluralize(overview.households, 'Mietverhältnis', 'Mietverhältnissen')}`,
			`${formatCents(overview.rent)} Warmmiete im Monat`,
			overview.tenure === null
				? null
				: `im Schnitt ${formatNumber(overview.tenure, 1)} Jahre Mietdauer`
		]
			.filter(Boolean)
			.join(' · ')
	);

	function address(tenant: {
		street: string | null;
		postalCode: string | null;
		city: string | null;
	}) {
		return [tenant.street, [tenant.postalCode, tenant.city].filter(Boolean).join(' ')]
			.filter(Boolean)
			.join(', ');
	}
</script>

<PageHeader title="Mieter" lead="Alle Personen und Firmen, die bei dir mieten oder gemietet haben.">
	{#snippet actions()}
		<CreateButton href="/mieter/neu" label="Mieter anlegen" />
	{/snippet}
</PageHeader>

{#if data.tenants.length === 0 && data.archived.length === 0}
	<EmptyState
		title="Du hast noch keine Mieter angelegt."
		text="Lege den ersten Mieter an oder importiere deine Mieter aus einer CSV-Datei."
	>
		<CreateButton href="/mieter/neu" label="Mieter anlegen" />
		<a href="/einstellungen/datenuebernahme" class="button secondary">Importieren</a>
	</EmptyState>
{:else}
	{#if data.pending.length > 0}
		<section aria-labelledby="pending-title">
			<h2 id="pending-title" class="pending-title">Steht an</h2>
			<ul class="pending">
				{#each data.pending as item (item.kind + item.tenantId)}
					<li class="card {item.kind}">
						<span class="dot" aria-hidden="true"></span>
						<div>
							<a href="/mieter/{item.tenantId}"><strong>{item.name}</strong></a>
							<p>
								{#if item.kind === 'arrears'}
									Seit {formatMonth(item.openSince)} offen: <Balance cents={item.overdue} />
									{#if item.reminder}<span class="muted reminder"
											>{reminderLevelLabels[item.reminder.level]} vom {formatDate(
												item.reminder.date
											)}</span
										>{/if}
								{:else if item.kind === 'out'}
									{#if item.terminatedBy === 'tenant'}Hat gekündigt, zieht am {formatDate(
											item.date
										)} aus
									{:else if item.terminatedBy === 'landlord'}Gekündigt, zieht am {formatDate(
											item.date
										)} aus
									{:else}Mietvertrag endet am {formatDate(item.date)}{/if}
									<span class="muted">· {item.label}</span>
								{:else}
									Zieht am {formatDate(item.date)} ein
									<span class="muted">· <a href="/vertraege/{item.id}">{item.label}</a></span>
								{/if}
							</p>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.tenants.length === 0}
		<p class="muted">Alle deine Mieter sind archiviert.</p>
	{:else}
		{#if overview.households > 0}
			<p class="summary muted">{summary}</p>
		{/if}
		<div class="list-toolbar">
			<h2>
				Deine Mieter <span class="result-count" aria-live="polite">{filteredTenants.length}</span>
			</h2>
			<label class="list-search"
				><span class="sr-only">Mieter durchsuchen</span><Icon name="search" size={16} /><input
					type="search"
					bind:value={search}
					placeholder="Name, Adresse oder Objekt suchen"
				/></label
			>
		</div>
		{#if filteredTenants.length === 0}
			<EmptyState
				title="Keine passenden Mieter"
				text="Versuche es mit einem anderen Namen, einer anderen Adresse oder einem anderen Objekt."
			>
				<button type="button" class="secondary" onclick={() => (search = '')}
					>Suche zurücksetzen</button
				>
			</EmptyState>
		{:else}
			<div class="table-wrap">
				<table class="table" aria-label="Mieter">
					<thead>
						<tr>
							<th>Name</th>
							<th>Mietet</th>
							<th class="num">Warmmiete</th>
							<th class="num">Mietkonto</th>
							<th>Mieter seit</th>
							<th>Hinweis</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredTenants as tenant, row (tenant.id)}
							<tr
								class:group-start={row > 0 && tenant.groupId !== filteredTenants[row - 1].groupId}
							>
								<td>
									<a href="/mieter/{tenant.id}"><strong>{personName(tenant)}</strong></a>
									{#if tenant.email || tenant.phone}<span class="muted small contact"
											>{tenant.email ?? tenant.phone}</span
										>{/if}
								</td>
								<td>
									{#if tenant.activeLeases.length > 0}
										{#each tenant.activeLeases as lease (lease.id)}
											<a class="lease" href="/vertraege/{lease.id}"
												>{lease.unit}<span class="muted small">{lease.property}</span></a
											>
										{/each}
									{:else if tenant.moveIn}
										<a class="lease" href="/vertraege/{tenant.moveIn.id}"
											>{tenant.moveIn.unit}<span class="muted small">{tenant.moveIn.property}</span
											></a
										>
									{:else}
										<span class="muted">keine</span>
									{/if}
								</td>
								<td class="num">
									{#if tenant.rent > 0}<Money cents={tenant.rent} />{:else}–{/if}
								</td>
								<td class="num">
									{#if tenant.overdue > 0}<Balance
											cents={tenant.overdue}
										/>{:else if tenant.activeLeases.length > 0}<span class="muted"
											>ausgeglichen</span
										>{:else}–{/if}
								</td>
								<td>{tenant.since ? formatDate(tenant.since) : '–'}</td>
								<td>
									<span class="badges">
										{#if tenant.overdue > 0}
											<Badge tone="danger">Rückstand</Badge>
											{#if tenant.reminders.length > 0}
												<Badge
													tone="danger"
													icon={false}
													title={tenant.reminders
														.map(
															(letter) =>
																`${reminderLevelLabels[letter.level]} vom ${formatDate(letter.date)}`
														)
														.join('\n')}>{tenant.reminders.length}. Mahnung</Badge
												>
											{/if}
										{/if}
										{#if tenant.moveOut}
											<Badge tone="warning">Auszug {formatDate(tenant.moveOut.date)}</Badge>
										{/if}
										{#if tenant.moveIn}
											<Badge tone="info">Einzug {formatDate(tenant.moveIn.date)}</Badge>
										{/if}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
	{#if data.archived.length > 0}
		<details class="archive">
			<summary>Archiviert ({data.archived.length})</summary>
			<ul class="archive-list" aria-label="Archivierte Mieter">
				{#each data.archived as tenant (tenant.id)}
					<li>
						<a href="/mieter/{tenant.id}">{personName(tenant)}</a>
						<span class="muted"> · archiviert am {formatDate(tenant.archivedAt!)}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
{/if}

<style>
	/* A slightly stronger line where the next property's tenants begin. On a phone the rows are
	   cards whose bottom border already draws 1px, so the group start only adds 1px on top. */
	.group-start td {
		border-top: 2px solid var(--color-border);
	}
	@media (max-width: 40rem) {
		.group-start {
			border-top: 1px solid var(--color-border);
		}
		.group-start td {
			border-top: 0;
		}
	}
	.pending-title {
		margin-top: 0;
	}
	.pending {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
		gap: 0.75rem;
		margin: 0 0 1.5rem;
		padding: 0;
		list-style: none;
	}
	.pending li {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 1rem 1.15rem;
	}
	.pending p {
		margin: 0.25rem 0 0;
		font-size: var(--text-sm);
	}
	/* Red for money owed, green for a tenant coming, grey for one leaving. */
	.dot {
		flex: none;
		width: 0.55rem;
		height: 0.55rem;
		margin-top: 0.45rem;
		border-radius: 50%;
		background: var(--color-muted);
	}
	.arrears .dot {
		background: var(--color-danger);
	}
	.in .dot {
		background: var(--color-success);
	}
	.reminder {
		display: block;
	}
	.summary {
		margin: 0 0 1.5rem;
	}
	.contact,
	.lease,
	.lease span {
		display: block;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.archive {
		margin-top: 2rem;
	}
	.archive summary {
		cursor: pointer;
		font-weight: 600;
	}
	.archive-list {
		display: grid;
		gap: 0.5rem;
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}
</style>
