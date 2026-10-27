<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LetterSheet from '#lib/components/LetterSheet.svelte';
	import type { Letter, LetterBlock } from '#lib/server/pdf.ts';

	// A link to a PDF or image that opens it in a dialog over the page instead of on its own,
	// with a download button. Without JavaScript, with a modifier key, or in a browser that shows
	// no PDF inside a page (Chrome on Android), the link opens the file as before. A letter whose
	// text can be edited (`text`) shows as a sheet whose paragraphs are edited where they stand;
	// the PDF is made from the saved text.
	let {
		href,
		download = href,
		title,
		image = false,
		text,
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
		/** The letter's text endpoint: GET the letter as laid out, PUT `{ paragraphs }`. */
		text?: string;
		class?: string;
		ariaLabel?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let dialog = $state<HTMLDialogElement>();

	let letter = $state<Letter & { blocks: LetterBlock[] }>();
	let paragraphs = $state<string[]>([]);
	let saved = $state<string[]>([]);
	let saving = $state(false);
	let problem = $state<string>();
	const clean = (values: string[]) => values.map((value) => value.trim()).join('\n\n');
	const dirty = $derived(letter !== undefined && clean(paragraphs) !== clean(saved));

	function show(event: MouseEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		if (!image && !text && navigator.pdfViewerEnabled === false) return;
		event.preventDefault();
		open = true;
		if (text) void load(text);
	}

	async function load(url: string) {
		letter = undefined;
		problem = undefined;
		const response = await fetch(url);
		if (!response.ok) {
			problem = 'Das Schreiben konnte nicht geladen werden.';
			return;
		}
		const loaded: Letter & { blocks: LetterBlock[] } = await response.json();
		const texts = loaded.blocks.flatMap((block) => ('paragraph' in block ? [block.paragraph] : []));
		paragraphs = [...texts];
		saved = [...texts];
		letter = loaded;
	}

	/** Saves the edited text; true when it is stored and the PDF will show it. */
	async function save(): Promise<boolean> {
		if (!text || !dirty) return true;
		saving = true;
		problem = undefined;
		try {
			const response = await fetch(text, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ paragraphs })
			});
			if (!response.ok) {
				problem =
					(await response.json().catch(() => undefined))?.message ??
					'Der Text konnte nicht gespeichert werden.';
				return false;
			}
			// Emptied paragraphs are gone from the letter now; the sheet shows what was stored.
			await load(text);
			return true;
		} finally {
			saving = false;
		}
	}

	function close() {
		if (dirty && !confirm('Die Änderungen am Text verwerfen?')) return;
		dialog?.close();
	}

	/** Saves first, so the downloaded PDF has the text on the sheet. */
	async function downloadSaved(event: MouseEvent) {
		if (!dirty) return;
		event.preventDefault();
		if (!(await save())) return;
		const link = document.createElement('a');
		link.href = download;
		link.download = '';
		link.click();
	}

	$effect(() => {
		if (dialog && !dialog.open) dialog.showModal();
	});

	/** Moves the dialog to the end of the page, so the styles of a table it opens from (a row's
	 * actions cell) do not reach the tables of the letter. */
	function portal(node: HTMLElement) {
		document.body.append(node);
		return { destroy: () => node.remove() };
	}
</script>

<a {href} class={className} aria-label={ariaLabel} onclick={show}>{@render children()}</a>
{#if open}
	<dialog
		use:portal
		bind:this={dialog}
		class="preview-dialog"
		aria-label={title}
		onclose={() => (open = false)}
		oncancel={(event) => {
			event.preventDefault();
			close();
		}}
		onclick={(event) => event.target === dialog && close()}
	>
		<div class="preview-header">
			<p class="preview-title">{title}</p>
			{#if text && letter}
				{#if dirty}
					<button
						type="button"
						class="secondary small"
						disabled={saving}
						onclick={() => (paragraphs = [...saved])}>Verwerfen</button
					>
					<button type="button" class="small" disabled={saving} onclick={save}>
						<Icon name="check" size={14} />
						Speichern
					</button>
				{:else}
					<span class="preview-hint">Zum Ändern in den Text klicken</span>
				{/if}
			{/if}
			<a class="button secondary small" href={download} download onclick={downloadSaved}>
				<Icon name="download" size={14} />
				Herunterladen
			</a>
			<button
				type="button"
				class="icon-button"
				aria-label="Vorschau schließen"
				title="Schließen"
				onclick={close}><Icon name="close" size={20} /></button
			>
		</div>
		{#if problem}<p class="preview-problem" role="alert">{problem}</p>{/if}
		<!-- Not editable while saving: the reload after the save would drop what is typed meanwhile. -->
		<div class="preview-body" class:sheet={text} inert={saving}>
			{#if text}
				{#if letter}<LetterSheet {letter} bind:paragraphs />{/if}
			{:else if image}
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
		display: flex;
		flex-direction: column;
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
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preview-header .button {
		align-self: center;
	}
	.preview-hint {
		color: var(--color-muted);
		font-size: var(--text-xs);
	}
	.preview-problem {
		margin: 0;
		padding: 0.5rem 1.25rem;
		background: var(--color-danger-subtle);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}
	.preview-body {
		flex: 1;
		min-height: 0;
		display: grid;
		place-items: center;
		background: var(--color-subtle);
	}
	/* The sheet scrolls from its top instead of being centred. */
	.preview-body.sheet {
		display: block;
		/* Chrome aligns block children by justify-items too; centred, the sheet would shrink. */
		place-items: normal;
		overflow: auto;
		/* A scroll bar coming and going would change the width the sheet is scaled to, and back. */
		scrollbar-gutter: stable;
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
		.preview-header {
			flex-wrap: wrap;
			padding-left: 1rem;
		}
		.preview-hint {
			display: none;
		}
	}
</style>
