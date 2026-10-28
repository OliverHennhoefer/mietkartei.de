<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import LeaseStatus from '#lib/components/LeaseStatus.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { byDate, byNumber, bySeverity, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const statusWeights = { active: 2, upcoming: 1, ended: 0 };
	const sort = new TableSort<PageProps['data']['leases'][number]>({
		label: byText((lease) => lease.label),
		tenants: byText((lease) => lease.tenants),
		period: byDate((lease) => lease.startDate),
		total: byNumber((lease) => lease.total),
		status: bySeverity((lease) => statusWeights[lease.status])
	});
</script>

<PageHeader title="Mietverträge" lead="Laufende Verträge zuerst, danach die beendeten.">
	{#snippet actions()}
		<CreateButton href="/vertraege/neu" label="Mietvertrag anlegen" />
	{/snippet}
</PageHeader>

{#if data.leases.length === 0}
	<EmptyState
		title="Du hast noch keine Mietverträge angelegt."
		text="Ein Mietvertrag braucht eine Einheit und einen Mieter. Lege zuerst an, was noch fehlt."
	>
		{#if !data.prerequisites.units}
			<CreateButton href="/objekte" label="Objekt und Einheit anlegen" secondary />
		{/if}
		{#if !data.prerequisites.tenants}
			<CreateButton href="/mieter/neu?return=/vertraege/neu" label="Mieter anlegen" secondary />
		{/if}
		{#if data.prerequisites.units && data.prerequisites.tenants}
			<CreateButton href="/vertraege/neu" label="Mietvertrag anlegen" />
		{/if}
	</EmptyState>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Mietverträge">
			<thead>
				<tr>
					<SortHeader {sort} key="label">Einheit · Objekt</SortHeader>
					<SortHeader {sort} key="tenants">Mieter</SortHeader>
					<SortHeader {sort} key="period">Laufzeit</SortHeader>
					<SortHeader {sort} key="total" class="num">Gesamtmiete</SortHeader>
					<SortHeader {sort} key="status">Status</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.leases) as lease (lease.id)}
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
