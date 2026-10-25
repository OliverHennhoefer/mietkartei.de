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
	<title>{title} | mietkartei</title>
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
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		margin-bottom: 2.25rem;
	}
	.back {
		margin: 0 0 1rem;
		font-size: 0.8rem;
		color: var(--color-muted);
	}
	.back a {
		text-decoration: none;
	}
	.back a:hover {
		color: var(--color-text);
	}
	.lead {
		margin: 0.65rem 0 0;
		font-size: 0.9rem;
		max-width: 45rem;
	}
	@media (max-width: 40rem) {
		/* A larger target for the thumb, without moving the link. */
		.back a {
			display: inline-block;
			padding-block: 0.6rem;
			margin-block: -0.6rem;
		}
	}
	.page-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
