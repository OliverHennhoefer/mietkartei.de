<script lang="ts">
	// The text of a field title. "(optional)" at its end shows as a quiet tag; the parentheses stay
	// in the accessible name, so the field is still called "Telefon (optional)".
	let { label }: { label: string } = $props();

	const suffix = ' (optional)';
	const optional = $derived(label.endsWith(suffix));
	// The space stays in the text: the name reads "Telefon (optional)", not "Telefon(optional)".
	const text = $derived(optional ? label.slice(0, -suffix.length + 1) : label);
</script>

{text}{#if optional}<span class="optional"
		><span class="paren">(</span>optional<span class="paren">)</span></span
	>{/if}

<style>
	/* Hidden but inline: an absolutely positioned .sr-only would put spaces into the name,
	   "Telefon ( optional )". */
	.paren {
		font-size: 0;
	}
	.optional {
		margin-left: 0.1rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--color-hover);
		color: var(--color-muted);
		font-size: var(--text-xs);
		font-weight: 500;
		white-space: nowrap;
	}
</style>
