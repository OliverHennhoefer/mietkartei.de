<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// Shown instead of an empty list, with a hint what to do first.
	let { title, text, children }: { title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="empty card">
	<span class="empty-icon"><Icon name="folder" size={24} /></span>
	<p class="empty-title">{title}</p>
	{#if text}<p class="muted">{text}</p>{/if}
	{#if children}<div class="empty-actions">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 4.5rem 1.5rem;
		background: var(--color-subtle);
		box-shadow: none;
	}
	.empty-icon {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		margin-bottom: 1.5rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-surface);
		color: var(--color-muted);
	}
	.empty p {
		margin: 0 0 0.5rem;
		max-width: 30rem;
		font-size: var(--text-base);
	}
	.empty-title {
		font-weight: 600;
		font-size: var(--text-lg);
	}
	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 1.25rem;
	}
</style>
