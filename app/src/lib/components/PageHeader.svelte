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

<!-- The actions sit at the right of the title, on a phone too, so a page's main action is always
     in the same place. -->
<div class="page-header">
	{#if back}<p class="back"><a href={back.href}>← {back.label}</a></p>{/if}
	<h1>{title}</h1>
	{#if actions}<div class="page-actions">{@render actions()}</div>{/if}
	{#if lead}<p class="muted lead">{lead}</p>{/if}
</div>

<style>
	.page-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 1.5rem;
		margin-bottom: 2.25rem;
	}
	.back,
	.lead {
		grid-column: 1 / -1;
	}
	.back {
		margin: 0 0 1rem;
		font-size: var(--text-xs);
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
		font-size: var(--text-base);
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
		justify-content: flex-end;
		gap: 0.5rem;
	}
	@media (max-width: 40rem) {
		.page-header {
			column-gap: 0.75rem;
		}
		/* Only the "+" of a create button, as a square. */
		.page-actions :global(.create) {
			width: 2.75rem;
			padding-inline: 0;
		}
		.page-actions :global(.create-label) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
