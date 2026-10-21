<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { personName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const address = $derived(
		[data.tenant.street, [data.tenant.postalCode, data.tenant.city].filter(Boolean).join(' ')]
			.filter(Boolean)
			.join(', ')
	);
</script>

<PageHeader
	title={personName(data.tenant)}
	lead={data.tenant.salutation ?? undefined}
	back={{ href: '/mieter', label: 'Alle Mieter' }}
>
	{#snippet actions()}
		<a href="/vertraege/neu?tenantId={data.tenant.id}" class="button secondary"
			>Mietvertrag anlegen</a
		>
		<a href="/mieter/{data.tenant.id}/bearbeiten" class="button">Bearbeiten</a>
	{/snippet}
</PageHeader>

{#if form?.deleteError}
	<Alert tone="danger"><p>{form.deleteError}</p></Alert>
{/if}

<h2>Kontakt</h2>
<dl class="details">
	<dt>E-Mail-Adresse</dt>
	<dd>
		{#if data.tenant.email}<a href="mailto:{data.tenant.email}">{data.tenant.email}</a>{:else}–{/if}
	</dd>
	<dt>Telefon</dt>
	<dd>{data.tenant.phone ?? '–'}</dd>
	<dt>Adresse</dt>
	<dd>{address || 'wie die gemietete Einheit'}</dd>
	{#if data.tenant.notes}
		<dt>Notizen</dt>
		<dd class="notes">{data.tenant.notes}</dd>
	{/if}
</dl>

<h2>Mietverträge</h2>
{#if data.leases.length === 0}
	<p class="muted">Dieser Mieter steht auf keinem Mietvertrag.</p>
{:else}
	<ul class="list" aria-label="Mietverträge">
		{#each data.leases as lease (lease.id)}
			<li class="card">
				<span>
					<a href="/vertraege/{lease.id}"><strong>{lease.label}</strong></a>
					<span class="muted">
						· seit {formatDate(lease.startDate)}{#if lease.endDate}
							bis {formatDate(lease.endDate)}{/if}
					</span>
				</span>
				{#if lease.active}
					<Badge tone="success">Aktiv</Badge>
				{:else if lease.upcoming}
					<Badge tone="info">Beginnt später</Badge>
				{:else}
					<Badge>Beendet</Badge>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<h2>Löschen</h2>
<p class="muted small">
	Ein Mieter, der auf einem Mietvertrag steht, bleibt erhalten; die Verträge sind die Historie.
</p>
<ConfirmButton action="?/delete" label="Mieter löschen" message="Diesen Mieter wirklich löschen?" />

<style>
	.notes {
		white-space: pre-line;
	}
</style>
