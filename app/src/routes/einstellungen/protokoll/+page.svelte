<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import { auditActionLabels, auditEntityLabels } from '#lib/labels.ts';
	import { byDate, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const entityLabel = (entity: string) => auditEntityLabels[entity] ?? entity;
	const actionLabel = (action: string) => auditActionLabels[action] ?? action;

	const sort = new TableSort<PageProps['data']['entries'][number]>({
		at: byDate((entry) => entry.at),
		user: byText((entry) => entry.userName ?? entry.userEmail ?? 'System'),
		entity: byText((entry) => entityLabel(entry.entity)),
		action: byText((entry) => actionLabel(entry.action)),
		summary: byText((entry) => entry.summary)
	});
</script>

<PageHeader
	title="Protokoll"
	lead="Wer wann was geändert hat, die neuesten {data.limit} Einträge."
/>

<form method="GET" class="toolbar">
	<label class="inline">
		Bereich
		<select name="entity" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
			<option value="" selected={data.entity === ''}>Alle</option>
			{#each data.entities as entity (entity)}
				<option value={entity} selected={data.entity === entity}>{entityLabel(entity)}</option>
			{/each}
		</select>
	</label>
	<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
</form>

{#if data.entries.length === 0}
	<p class="muted">Noch keine Einträge.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Protokoll">
			<thead>
				<tr>
					<SortHeader {sort} key="at">Zeit</SortHeader>
					<SortHeader {sort} key="user">Wer</SortHeader>
					<SortHeader {sort} key="entity">Bereich</SortHeader>
					<SortHeader {sort} key="action">Aktion</SortHeader>
					<SortHeader {sort} key="summary">Was</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.entries) as entry (entry.id)}
					<tr>
						<td>{formatDateTime(entry.at)}</td>
						<td>{entry.userName ?? entry.userEmail ?? 'System'}</td>
						<td>{entityLabel(entry.entity)}</td>
						<td>{actionLabel(entry.action)}</td>
						<td>{entry.summary}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
