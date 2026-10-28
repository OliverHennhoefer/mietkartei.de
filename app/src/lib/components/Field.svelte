<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tip from './Tip.svelte';

	// Title, input (passed as children) and the field's error below it. A hint is static help and
	// sits behind a (?) at the title; a note is shown under the field, for computed values and
	// warnings that must be seen without asking.
	let {
		label,
		error,
		hint,
		note,
		children
	}: { label: string; error?: string; hint?: string; note?: string; children: Snippet } = $props();
</script>

<!-- The (?) is outside the label: a button inside it would take the label's click and name. -->
<div class="field">
	<label>
		<span class="title">{label}</span>
		{@render children()}
		{#if error}<span class="error">{error}</span>{:else if note}<span class="note">{note}</span
			>{/if}
	</label>
	{#if hint}<Tip text={hint} />{/if}
</div>

<style>
	.field {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0.5rem 0.25rem;
		min-width: 0;
		font-weight: 500;
		font-size: var(--text-sm);
	}
	.field > label {
		display: contents;
	}
	.field > label > :global(*) {
		grid-column: 1 / -1;
	}
	.field > label > .title {
		grid-row: 1;
		grid-column: 1;
	}
	.field > :global(.tip) {
		grid-row: 1;
		grid-column: 2;
		justify-self: start;
	}
	.note {
		color: var(--color-muted);
		font-weight: 400;
		font-size: var(--text-sm);
	}
</style>
