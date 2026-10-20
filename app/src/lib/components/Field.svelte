<script lang="ts">
	import type { Snippet } from 'svelte';

	// Label, input (passed as children) and the field's error or hint below it.
	let {
		label,
		error,
		hint,
		children
	}: { label: string; error?: string; hint?: string; children: Snippet } = $props();
</script>

<label>
	{label}
	{@render children()}
	{#if error}<span class="error">{error}</span>{:else if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
	.hint {
		color: var(--color-muted);
		font-weight: 400;
		font-size: 0.85rem;
	}
</style>
