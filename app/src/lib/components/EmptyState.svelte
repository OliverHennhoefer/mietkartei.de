<script lang="ts">
	import type { Snippet } from 'svelte';

	// Shown instead of an empty list, with a hint what to do first.
	let { title, text, children }: { title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="empty card">
	<p class="empty-title">{title}</p>
	{#if text}<p class="muted">{text}</p>{/if}
	{#if children}<div class="empty-actions">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		text-align: center;
		padding: 2rem 1rem;
	}
	.empty p {
		margin: 0 0 0.5rem;
	}
	.empty-title {
		font-weight: 500;
	}
	.empty-actions {
		margin-top: 1rem;
	}
</style>
