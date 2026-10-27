<script lang="ts">
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import { canInline } from '#lib/domain/documents.ts';

	// A document's name as a link: a PDF or image opens in the preview dialog, anything else is
	// saved.
	let { document }: { document: { id: string; name: string; mimeType: string } } = $props();

	const download = $derived(`/dokumente/${document.id}/herunterladen`);
</script>

{#if canInline(document.mimeType)}
	<PreviewLink
		href="{download}?inline=1"
		{download}
		title={document.name}
		image={document.mimeType.startsWith('image/')}>{document.name}</PreviewLink
	>
{:else}
	<a href={download}>{document.name}</a>
{/if}
