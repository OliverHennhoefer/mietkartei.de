<script lang="ts">
	import LeaseStatus from '#lib/components/LeaseStatus.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader title="Mietverträge">
	{#snippet actions()}
		<a href="/vertraege/neu" class="button">Mietvertrag anlegen</a>
	{/snippet}
</PageHeader>

{#if data.leases.length === 0}
	<EmptyState
		title="Du hast noch keine Mietverträge angelegt."
		text="Ein Mietvertrag braucht eine Einheit und einen Mieter. Lege zuerst an, was noch fehlt."
	>
		{#if !data.prerequisites.units}
			<a href="/objekte" class="button secondary">Objekt und Einheit anlegen</a>
		{/if}
		{#if !data.prerequisites.tenants}
			<a href="/mieter/neu?return=/vertraege/neu" class="button secondary">Mieter anlegen</a>
		{/if}
		{#if data.prerequisites.units && data.prerequisites.tenants}
			<a href="/vertraege/neu" class="button">Mietvertrag anlegen</a>
		{/if}
	</EmptyState>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Mietverträge">
			<thead>
				<tr>
					<th>Einheit · Objekt</th>
					<th>Mieter</th>
					<th>Laufzeit</th>
					<th class="num">Gesamtmiete</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.leases as lease (lease.id)}
					<tr>
						<td>
							<a href="/vertraege/{lease.id}"><strong>{lease.label}</strong></a>
							{#if lease.extraUnits.length > 0}
								<span class="muted small">+ {lease.extraUnits.join(', ')}</span>
							{/if}
						</td>
						<td>{lease.tenants || '–'}</td>
						<td>
							{formatDate(lease.startDate)} –
							{lease.endDate ? formatDate(lease.endDate) : 'unbefristet'}
						</td>
						<td class="num"><Money cents={lease.total} /></td>
						<td>
							<LeaseStatus status={lease.status} />
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
