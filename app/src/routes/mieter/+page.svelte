<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { personName } from '#lib/format.ts';
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

	function address(tenant: {
		street: string | null;
		postalCode: string | null;
		city: string | null;
	}) {
		const line = [tenant.street, [tenant.postalCode, tenant.city].filter(Boolean).join(' ')]
			.filter(Boolean)
			.join(', ');
		return line || '–';
	}
</script>

<PageHeader title="Mieter" lead="Alle Personen und Firmen, die bei dir mieten oder gemietet haben.">
	{#snippet actions()}
		<a href="/mieter/neu" class="button">Mieter anlegen</a>
	{/snippet}
</PageHeader>

{#if data.tenants.length === 0 && data.archived.length === 0}
	<EmptyState
		title="Du hast noch keine Mieter angelegt."
		text="Lege den ersten Mieter an oder importiere deine Mieter aus einer CSV-Datei."
	>
		<a href="/mieter/neu" class="button">Mieter anlegen</a>
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
							<th>Name</th>
							<th>Adresse</th>
							<th>Aktive Mietverträge</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredTenants as tenant, row (tenant.id)}
							<tr
								class:group-start={row > 0 && tenant.groupId !== filteredTenants[row - 1].groupId}
							>
								<td>
									<a href="/mieter/{tenant.id}"><strong>{personName(tenant)}</strong></a>
									{#if tenant.salutation}<span class="muted small">
											({tenant.salutation})</span
										>{/if}
								</td>
								<td>{address(tenant)}</td>
								<td>
									{#if tenant.activeLeases.length === 0}
										<span class="muted">keine</span>
									{:else}
										{#each tenant.activeLeases as lease, index (lease.id)}
											{#if index > 0},{/if}
											<a href="/vertraege/{lease.id}">{lease.label}</a>
										{/each}
									{/if}
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
