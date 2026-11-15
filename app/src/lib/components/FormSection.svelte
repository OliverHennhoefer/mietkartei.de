<script lang="ts">
	import { getContext, type Snippet } from 'svelte';

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

	// Under a page's own heading (h1) the groups are its sections, h2; a page that sets the
	// context "form-heading-level" says so. Under an h2 they stay h3.
	const level = getContext<number | undefined>('form-heading-level') ?? 3;
</script>

<section class="form-section">
	<div class="form-section-head">
		<svelte:element this={`h${level}`} class="form-section-title">{title}</svelte:element>
		{#if about}<p>{@render about()}</p>{:else if description}<p>{description}</p>{/if}
	</div>
	<div class="form">
		{@render children()}
	</div>
</section>
