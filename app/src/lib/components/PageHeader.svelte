<script lang="ts">
	import type { Snippet } from 'svelte';

	// The heading of a page, with an optional line above it (back link), a lead text and actions.
	let {
		title,
		lead,
		back,
		actions
	}: {
		title: string;
		lead?: string;
		/** A link shown above the title, e.g. `{ href: '/objekte', label: 'Alle Objekte' }`. */
		back?: { href: string; label: string };
		actions?: Snippet;
	} = $props();
</script>

<svelte:head>
	<title>{title} · mietkartei</title>
</svelte:head>

<div class="page-header">
	<div>
		{#if back}<p class="back"><a href={back.href}>← {back.label}</a></p>{/if}
		<h1>{title}</h1>
		{#if lead}<p class="muted lead">{lead}</p>{/if}
	</div>
	{#if actions}<div class="page-actions">{@render actions()}</div>{/if}
</div>

<style>
	.page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		margin-bottom: 1.5rem;
	}
	.back {
		margin: 0 0 0.25rem;
		font-size: 0.9rem;
	}
	.lead {
		margin: 0.25rem 0 0;
	}
	.page-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
