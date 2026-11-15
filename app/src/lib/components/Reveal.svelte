<script lang="ts">
	import type { Snippet } from 'svelte';

	// A form folded behind a secondary button until it is wanted. `open` (after a refused submit)
	// renders it unfolded. The two branches keep `open` a static attribute: a reactive one would be
	// set again when the page hydrates and fold away what was opened with a click before that.
	let {
		label,
		open = false,
		children
	}: { label: string; open?: boolean; children: Snippet } = $props();
</script>

{#if open}
	<details class="reveal" open>
		<summary class="button secondary small">{label}</summary>
		{@render children()}
	</details>
{:else}
	<details class="reveal">
		<summary class="button secondary small">{label}</summary>
		{@render children()}
	</details>
{/if}
