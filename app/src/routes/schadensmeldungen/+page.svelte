<script lang="ts">
	import DamageReportList from '#lib/components/DamageReportList.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title="Schadensmeldungen"
	lead="Was deine Mieter über das Mieterportal melden. Den Link zum Portal erzeugst du im Mietvertrag unter „Mieterportal“."
/>

{#if data.open.length === 0 && data.done.length === 0}
	<EmptyState
		title="Noch keine Schadensmeldungen"
		text="Gib deinen Mietern den Link zu ihrem Mieterportal: Öffne einen Mietvertrag, wähle „Mieterportal“ und erzeuge den Link."
	>
		<a href="/vertraege" class="button secondary">Zu den Mietverträgen</a>
	</EmptyState>
{:else}
	<h2>Offen</h2>
	{#if data.open.length === 0}
		<p class="muted">Keine offenen Schadensmeldungen.</p>
	{:else}
		<DamageReportList reports={data.open} label="Offene Schadensmeldungen" />
	{/if}

	{#if data.done.length > 0}
		<details class="done">
			<summary
				>{data.done.length === 1
					? 'Eine erledigte Schadensmeldung'
					: `${data.done.length} erledigte Schadensmeldungen`}</summary
			>
			<DamageReportList reports={data.done} label="Erledigte Schadensmeldungen" />
		</details>
	{/if}
{/if}

<style>
	.done {
		margin-top: 1rem;
	}
	.done summary {
		cursor: pointer;
		color: var(--color-muted);
		margin-bottom: 0.5rem;
	}
</style>
