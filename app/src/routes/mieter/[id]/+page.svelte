<script lang="ts">
	import ArchiveSection from '#lib/components/ArchiveSection.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import DeleteSection from '#lib/components/DeleteSection.svelte';
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
	lead={[
		data.tenant.salutation,
		data.tenant.archivedAt ? `archiviert am ${formatDate(data.tenant.archivedAt)}` : null
	]
		.filter(Boolean)
		.join(' · ') || undefined}
	back={{ href: '/mieter', label: 'Alle Mieter' }}
>
	{#snippet actions()}
		{#if !data.tenant.archivedAt}
			<a href="/vertraege/neu?tenantId={data.tenant.id}" class="button secondary"
				>Mietvertrag anlegen</a
			>
		{/if}
		<a href="/mieter/{data.tenant.id}/bearbeiten" class="button">Bearbeiten</a>
	{/snippet}
</PageHeader>

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

<h2>Dokumente</h2>
<p><a href="/dokumente?tenantId={data.tenant.id}">Dokumente dieses Mieters</a></p>

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
</style>
