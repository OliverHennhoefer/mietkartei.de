<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { reminderLevelLabels } from '#lib/domain/reminders.ts';
	import { personName } from '#lib/format.ts';
	import { byDate, byNumber, bySeverity, byText, TableSort } from '#lib/table-sort.svelte.ts';
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
	type Tenant = PageProps['data']['tenants'][number];
	const sort = new TableSort<Tenant>({
		name: byText(personName),
		lease: byText((tenant) => {
			const lease = tenant.activeLeases[0] ?? tenant.moveIn;
			return lease && `${lease.property} ${lease.unit}`;
		}),
		rent: byNumber((tenant) => tenant.rent || null),
		balance: byNumber((tenant) => (tenant.activeLeases.length > 0 ? tenant.overdue : null)),
		since: byDate((tenant) => tenant.since),
		hints: bySeverity(
			(tenant) =>
				(tenant.overdue > 0 ? 100 + 10 * tenant.reminders.length : 0) +
				(tenant.moveOut ? 2 : 0) +
				(tenant.moveIn ? 1 : 0)
		)
	});
	const sortedTenants = $derived(sort.rows(filteredTenants));
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

<PageHeader title="Mieter">
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
	{#if data.tenants.length === 0}
		<p class="muted">Alle deine Mieter sind archiviert.</p>
	{:else}
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
							<SortHeader {sort} key="name">Name</SortHeader>
							<SortHeader {sort} key="lease">Mietet</SortHeader>
							<SortHeader {sort} key="rent" class="num">Warmmiete</SortHeader>
							<SortHeader {sort} key="balance" class="num">Mietkonto</SortHeader>
							<SortHeader {sort} key="since">Mieter seit</SortHeader>
							<SortHeader {sort} key="hints">Hinweis</SortHeader>
						</tr>
					</thead>
					<tbody>
						{#each sortedTenants as tenant, row (tenant.id)}
							<tr
								class:group-start={!sort.active &&
									row > 0 &&
									tenant.groupId !== sortedTenants[row - 1].groupId}
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
											{#if tenant.reminder}
												<Badge
													tone="danger"
													icon={false}
													title={tenant.reminders
														.map(
															(letter) =>
																`${reminderLevelLabels[letter.level]} vom ${formatDate(letter.date)}`
														)
														.join('\n')}
													>{reminderLevelLabels[tenant.reminder.level]} vom {formatDate(
														tenant.reminder.date
													)}</Badge
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
									{#if tenant.overdue > 0 && tenant.openSince}<span class="muted small note"
											>Seit {formatMonth(tenant.openSince)} offen</span
										>{/if}
									{#if tenant.moveOut}<span class="muted small note"
											>{tenant.moveOut.terminatedBy === 'tenant'
												? 'Hat gekündigt'
												: tenant.moveOut.terminatedBy === 'landlord'
													? 'Von dir gekündigt'
													: 'Mietvertrag endet'}</span
										>{/if}
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
	.contact,
	.lease,
	.lease span {
		display: block;
	}
	.note {
		display: block;
		margin-top: 0.3rem;
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
