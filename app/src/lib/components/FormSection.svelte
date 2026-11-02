<script lang="ts">
	import type { Snippet } from 'svelte';

	// A titled group of fields in a longer form: the title and what the group is for on the left,
	// the fields in up to two columns on the right. Narrow forms put the title above the fields.
	// `about` takes text with links or emphasis; `description` plain text. The section has no
	// accessible name: as a named region each group would be a landmark, and a group named like its
	// only field ("Notizen") would give two elements of that name.
	let {
		title,
		description,
		about,
		children
	}: { title: string; description?: string; about?: Snippet; children: Snippet } = $props();
</script>

<section class="form-section">
	<div class="form-section-head">
		<h3>{title}</h3>
		{#if about}<p>{@render about()}</p>{:else if description}<p>{description}</p>{/if}
	</div>
	<div class="form">
		{@render children()}
	</div>
</section>
