<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';

	// A link to a PDF or image that opens it in a dialog over the page instead of on its own,
	// with a download button. Without JavaScript, with a modifier key, or in a browser that shows
	// no PDF inside a page (Chrome on Android), the link opens the file as before.
	let {
		href,
		download = href,
		title,
		image = false,
		class: className,
		ariaLabel,
		children
	}: {
		/** The file served inline. */
		href: string;
		/** The file served as a download; the same URL by default, saved by the download attribute. */
		download?: string;
		/** The dialog's heading, usually the file's or letter's name. */
		title: string;
		/** An image is shown as one, everything else in a frame. */
		image?: boolean;
		class?: string;
		ariaLabel?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let dialog = $state<HTMLDialogElement>();

	function show(event: MouseEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		if (!image && navigator.pdfViewerEnabled === false) return;
		event.preventDefault();
		open = true;
	}

	$effect(() => {
		if (dialog && !dialog.open) dialog.showModal();
	});
</script>

<a {href} class={className} aria-label={ariaLabel} onclick={show}>{@render children()}</a>
{#if open}
	<dialog
		bind:this={dialog}
		class="preview-dialog"
		aria-label={title}
		onclose={() => (open = false)}
		onclick={(event) => event.target === dialog && dialog.close()}
	>
		<div class="preview-header">
			<p class="preview-title">{title}</p>
			<a class="button secondary small" href={download} download>
				<Icon name="download" size={14} />
				Herunterladen
			</a>
			<button
				type="button"
				class="icon-button"
				aria-label="Vorschau schließen"
				title="Schließen"
				onclick={() => dialog?.close()}><Icon name="close" size={20} /></button
			>
		</div>
		<div class="preview-body">
			{#if image}
				<img src={href} alt={title} />
			{:else}
				<iframe src={href} {title}></iframe>
			{/if}
		</div>
	</dialog>
{/if}

<style>
	.preview-dialog {
		position: fixed;
		inset: 0;
		width: min(64rem, calc(100vw - 2rem));
		height: calc(100dvh - 2rem);
		max-width: none;
		max-height: none;
		margin: auto;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 24px 64px rgb(0 0 0 / 22%);
		overflow: hidden;
		text-align: left;
		white-space: normal;
	}
	.preview-dialog[open] {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}
	.preview-dialog::backdrop {
		background: rgb(0 0 0 / 35%);
	}
	.preview-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem 0.6rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.preview-title {
		flex: 1;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		font-weight: 550;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preview-header .button {
		align-self: center;
	}
	.preview-body {
		display: grid;
		place-items: center;
		background: var(--color-subtle);
	}
	iframe {
		width: 100%;
		height: 100%;
		border: 0;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	@media (max-width: 40rem) {
		.preview-dialog {
			width: 100vw;
			height: 100dvh;
			border: 0;
			border-radius: 0;
		}
	}
</style>
