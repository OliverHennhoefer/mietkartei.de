<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const until = $derived(form && 'snoozed' in form ? form.snoozed : data.snoozedUntil);
</script>

<PageHeader title="Später erinnern" />

<section class="card">
	<h2>{data.entry.title}</h2>
	<p>
		{data.entry.kind === 'task' ? 'Fällig' : 'Frist'} am {formatDate(data.entry.date)}{data.entry
			.overdue
			? ', überfällig'
			: ''}
	</p>
	{#if data.entry.description}<p class="muted">{data.entry.description}</p>{/if}
	<p><a href={data.entry.href}>Öffnen</a></p>
</section>

{#if form && 'done' in form}
	<Alert tone="success"><p>Die Aufgabe ist erledigt.</p></Alert>
{:else}
	{#if until}
		<Alert tone="success">
			<p>Bis zum {formatDate(until)} kommt dazu kein Hinweis.</p>
		</Alert>
	{/if}
	{#if form && 'message' in form}
		<p class="error" role="alert">{form.message}</p>
	{/if}
	<div class="form-actions">
		{#each data.days as days (days)}
			<form method="POST" action="?/snooze" use:enhance>
				<input type="hidden" name="days" value={String(days)} />
				<button type="submit" class="secondary">
					{days === 7 ? 'In einer Woche' : days === 14 ? 'In zwei Wochen' : `In ${days} Tagen`}
				</button>
			</form>
		{/each}
		{#if data.canComplete}
			<form method="POST" action="?/done" use:enhance>
				<button type="submit">Erledigt</button>
			</form>
		{/if}
	</div>
{/if}

<style>
	.card {
		margin-bottom: 1.25rem;
	}
	.card h2 {
		margin-top: 0;
	}
</style>
