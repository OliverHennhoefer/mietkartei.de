<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
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

{#if data.tenants.length === 0}
	<EmptyState
		title="Du hast noch keine Mieter angelegt."
		text="Lege den ersten Mieter an oder importiere deine Mieter aus einer CSV-Datei."
	>
		<a href="/mieter/neu" class="button">Mieter anlegen</a>
		<a href="/import" class="button secondary">Importieren</a>
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
