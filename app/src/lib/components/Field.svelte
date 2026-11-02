<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tip from './Tip.svelte';

	// Title, input (passed as children) and the field's error below it. A hint is static help and
	// sits behind a (?) at the title; a note is shown under the field, for computed values and
	// warnings that must be seen without asking.
	//
	// In the shared form grid (form.card, .form) the field spans two rows of it, titles and controls, as a subgrid: a title
	// that wraps to two lines makes the whole row of titles taller, so the inputs of a row stay on
	// one line. The titles sit at the bottom of their row, right above their input.
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
		<span class="control">
			{@render children()}
			{#if error}<span class="error">{error}</span>{:else if note}<span class="note">{note}</span
				>{/if}
		</span>
	</label>
	{#if hint}<Tip text={hint} />{/if}
</div>

<style>
	.field {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: end;
		gap: 0.5rem 0.25rem;
		min-width: 0;
		font-weight: 500;
		font-size: var(--text-sm);
	}
	/* Only in the shared form grid: custom row layouts keep the field in one row of theirs. */
	:global(:is(form.card, .form)) > .field {
		grid-row: span 2;
		grid-template-rows: subgrid;
	}
	.field > label {
		display: contents;
	}
	.title {
		grid-row: 1;
		grid-column: 1;
	}
	.field > :global(.tip) {
		grid-row: 1;
		grid-column: 2;
		justify-self: start;
	}
	.control {
		display: grid;
		grid-row: 2;
		grid-column: 1 / -1;
		align-self: start;
		gap: 0.5rem;
		min-width: 0;
	}
	.note {
		color: var(--color-muted);
		font-weight: 400;
		font-size: var(--text-sm);
	}
</style>
