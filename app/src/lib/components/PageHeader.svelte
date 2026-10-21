<script lang="ts">
	// The heading of a page, with an optional line above it (back link) and a lead text.
	let {
		title,
		lead,
		back
	}: {
		title: string;
		lead?: string;
		/** A link shown above the title, e.g. `{ href: '/objekte', label: 'Alle Objekte' }`. */
		back?: { href: string; label: string };
	} = $props();
</script>

<svelte:head>
	<title>{title} · mietkartei</title>
</svelte:head>

<div class="page-header">
	{#if back}<p class="back"><a href={back.href}>← {back.label}</a></p>{/if}
	<h1>{title}</h1>
	{#if lead}<p class="muted lead">{lead}</p>{/if}
</div>

<style>
	.page-header {
		margin-bottom: 1.5rem;
	}
	.back {
		margin: 0 0 0.25rem;
		font-size: 0.9rem;
	}
	.lead {
		margin: 0.25rem 0 0;
	}
</style>
