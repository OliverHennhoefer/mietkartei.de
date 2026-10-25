<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { personName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

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
					{#each data.tenants as tenant (tenant.id)}
						<tr>
							<td>
								<a href="/mieter/{tenant.id}"><strong>{personName(tenant)}</strong></a>
								{#if tenant.salutation}<span class="muted small"> ({tenant.salutation})</span>{/if}
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
