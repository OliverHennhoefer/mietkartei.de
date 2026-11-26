<script lang="ts">
	import { untrack } from 'svelte';
	import LetterSheet from '../lib/components/LetterSheet.svelte';
	import {
		applyLetterEdits,
		letterEditsOf,
		letterParagraphs,
		type ToolLetterEdit
	} from '../lib/domain/statement-tool';
	import type { Letter } from '../lib/domain/letters';

	// One tenant's letter as a sheet of paper whose paragraphs are edited where they stand, like the
	// letters in the app. Tables, amounts and addresses come from the computation and stay as they
	// are. The wording is kept as edits of the computed paragraphs: when new numbers change a
	// paragraph, its edit no longer applies and shows here for review instead of printing old
	// numbers.
	let {
		title,
		letter,
		edits,
		busy,
		onsave,
		ondownload,
		onclose
	}: {
		title: string;
		/** The letter as computed, without the landlord's wording. */
		letter: Letter;
		edits: ToolLetterEdit[];
		busy: boolean;
		onsave: (edits: ToolLetterEdit[]) => void;
		ondownload: (letter: Letter) => void;
		onclose: () => void;
	} = $props();

	// The computed letter is fixed while the dialog is open; the form behind it cannot change.
	const { computed, given } = untrack(() => ({
		computed: { ...letter, blocks: letter.blocks ?? [] },
		given: edits
	}));
	const originals = letterParagraphs(computed);
	const applied = applyLetterEdits(computed, given);
	const stale = $state(applied.stale);
	// The sheet shows every computed paragraph; one the landlord removed shows empty.
	const start = originals.map((original) => {
		const edit = given.find((entry) => entry.original === original);
		return edit ? edit.text : original;
	});
	let paragraphs = $state([...start]);
	let staleKept = $state(stale.map(() => true));

	const changed = $derived(
		paragraphs.some((text, index) => clean(text) !== clean(start[index])) ||
			staleKept.some((kept) => !kept)
	);
	const edited = $derived(letterEditsOf(originals, paragraphs).length > 0);

	function clean(text: string): string {
		return text.replace(/\u00a0/g, ' ').trim();
	}

	function current(): ToolLetterEdit[] {
		return [
			...letterEditsOf(originals, paragraphs),
			...stale.filter((_, index) => staleKept[index])
		];
	}

	function save() {
		onsave(current());
	}

	function restore() {
		paragraphs = [...originals];
	}

	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (dialog && !dialog.open) dialog.showModal();
	});

	function close() {
		if (changed) save();
		onclose();
	}
</script>

<dialog
	bind:this={dialog}
	class="letter-dialog"
	aria-label={title}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
	onclick={(event) => event.target === dialog && close()}
>
	<div class="letter-header">
		<div class="letter-title">
			<p>{title}</p>
			<span>Klick in den Text, um ihn zu ändern. Beträge und Tabellen rechnet der Rechner.</span>
		</div>
		<div class="letter-actions">
			{#if edited}
				<button class="link" type="button" onclick={restore}>Ursprünglichen Text</button>
			{/if}
			<button
				class="small"
				type="button"
				disabled={busy}
				onclick={() => {
					save();
					ondownload(applyLetterEdits(computed, current()).letter);
				}}
			>
				{busy ? 'Wird erstellt …' : 'PDF laden'}
			</button>
			<button class="small dark" type="button" onclick={close}>Fertig</button>
		</div>
	</div>
	{#if stale.length > 0}
		<div class="stale" role="status">
			<p>
				<strong>Die Zahlen haben sich geändert.</strong> Diese Absätze hattest du angepasst; der berechnete
				Text darunter ist jetzt ein anderer, darum steht im Brief wieder der neue Text. Übernimm deine
				Formulierung bei Bedarf neu.
			</p>
			{#each stale as edit, index (edit.original)}
				{#if staleKept[index]}
					<div class="stale-edit">
						<blockquote>{edit.text || '(Absatz gelöscht)'}</blockquote>
						<button class="link" type="button" onclick={() => (staleKept[index] = false)}
							>Erledigt</button
						>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
	<div class="letter-body">
		<LetterSheet letter={computed} bind:paragraphs />
	</div>
</dialog>

<style>
	.letter-dialog {
		position: fixed;
		inset: 0;
		width: min(64rem, calc(100vw - 2rem));
		height: calc(100dvh - 2rem);
		max-width: none;
		max-height: none;
		margin: auto;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 24px 64px rgb(0 0 0 / 22%);
		overflow: hidden;
		text-align: left;
	}
	.letter-dialog[open] {
		display: flex;
		flex-direction: column;
	}
	.letter-dialog::backdrop {
		background: rgb(0 0 0 / 45%);
	}
	.letter-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 24px;
		padding: 14px 20px;
		border-bottom: 1px solid var(--line);
	}
	.letter-title p {
		margin: 0;
		font-weight: 600;
	}
	.letter-title span {
		color: var(--muted);
		font-size: var(--text-sm);
	}
	.letter-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	button.small {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 16px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--background);
		color: var(--foreground);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	button.small:hover:not(:disabled) {
		border-color: var(--foreground);
	}
	button.small.dark {
		border-color: var(--foreground);
		background: var(--foreground);
		color: var(--background);
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	button.link {
		padding: 8px 0;
		border: 0;
		background: none;
		color: var(--muted);
		font-size: var(--text-sm);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	button.link:hover {
		color: var(--foreground);
	}
	.stale {
		padding: 12px 20px;
		border-bottom: 1px solid var(--line);
		border-left: 4px solid var(--highlight);
		font-size: var(--text-sm);
	}
	.stale p {
		margin: 0;
	}
	.stale-edit {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		margin-top: 10px;
	}
	.stale blockquote {
		flex: 1;
		margin: 0;
		padding: 8px 12px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--code-background), var(--background) 40%);
		white-space: pre-wrap;
	}
	.letter-body {
		flex: 1;
		overflow: auto;
		background: color-mix(in srgb, var(--code-background), var(--background) 20%);
	}
	@media (max-width: 600px) {
		.letter-dialog {
			width: 100vw;
			height: 100dvh;
			border-radius: 0;
		}
	}
</style>
