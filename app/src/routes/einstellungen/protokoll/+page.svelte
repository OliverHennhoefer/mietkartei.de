<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import { auditActionLabels, auditEntityLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const entityLabel = (entity: string) => auditEntityLabels[entity] ?? entity;
	const actionLabel = (action: string) => auditActionLabels[action] ?? action;
</script>

<PageHeader
	title="Protokoll"
	lead="Wer wann was geändert hat, die neuesten {data.limit} Einträge."
/>

<form method="GET" class="toolbar">
	<label class="inline">
		Bereich
		<select name="entity">
			<option value="" selected={data.entity === ''}>Alle</option>
			{#each data.entities as entity (entity)}
				<option value={entity} selected={data.entity === entity}>{entityLabel(entity)}</option>
			{/each}
		</select>
	</label>
	<button type="submit" class="secondary">Filtern</button>
</form>

{#if data.entries.length === 0}
	<p class="muted">Noch keine Einträge.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Protokoll">
			<thead>
				<tr>
					<th>Zeit</th>
					<th>Wer</th>
					<th>Bereich</th>
					<th>Aktion</th>
					<th>Was</th>
				</tr>
			</thead>
			<tbody>
				{#each data.entries as entry (entry.id)}
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
