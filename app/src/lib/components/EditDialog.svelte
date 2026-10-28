<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	import type { Snippet } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';

	// A row of a list in a dialog over the list: its fields, "Speichern" and "Abbrechen" at the
	// bottom left and "Löschen" set apart at the bottom right. A row that cannot be changed shows
	// what it holds instead (no `action`), one that cannot be deleted has no "Löschen". The list
	// opens it with a query parameter (?bearbeiten=<id>), so the back button closes it, a link can
	// lead to it and the server renders it open without JavaScript. Both buttons submit the one
	// form: "Löschen" to `deleteAction`, after a question and without checking the fields. When an
	// action redirects back to the list, the dialog closes.
	let {
		title,
		action,
		deleteAction,
		deleteMessage,
		close,
		error,
		children
	}: {
		title: string;
		/** The action that saves the fields; without it the dialog only shows the row. */
		action?: string;
		deleteAction?: string;
		/** The question before deleting. */
		deleteMessage?: string;
		/** The list without the dialog. */
		close: string;
		/** Why the server refused to save or delete, shown in the dialog, above the buttons. */
		error?: string;
		children: Snippet;
	} = $props();

	// The actions keep the page's query, so a refusal without JavaScript shows the dialog again.
	const query = $derived(
		[...new URLSearchParams(page.url.search)]
			.filter(([name]) => !name.startsWith('/'))
			.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}&`)
			.join('')
	);
	const withQuery = (target?: string) =>
		target?.startsWith('?/') ? `?${query}${target.slice(1)}` : target;
	const saveTarget = $derived(withQuery(action));
	const deleteTarget = $derived(withQuery(deleteAction));

	const id = $props.id();
	let dialog = $state<HTMLDialogElement>();
	// Opened from the list in this tab: closing goes back, so the back button does not reopen it.
	let fromList = false;
	afterNavigate(({ from, to }) => {
		fromList = from?.url.pathname === to?.url.pathname;
	});

	$effect(() => {
		if (!dialog || dialog.matches(':modal')) return;
		dialog.close();
		dialog.showModal();
	});

	function leave() {
		if (fromList) history.back();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the list page's own path
		else goto(close, { replace: true, reset: false });
	}

	const submit: SubmitFunction = ({ submitter, cancel }) => {
		const deleting = submitter?.getAttribute('formaction') === deleteTarget;
		if (deleting && deleteMessage && !confirm(deleteMessage)) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			// The list loads again for the page it is on, without the row, before the dialog goes.
			if (result.type === 'redirect') {
				await invalidateAll();
				leave();
			} else await update();
		};
	};
</script>

<dialog
	bind:this={dialog}
	class="edit-dialog"
	aria-labelledby={id}
	open
	oncancel={(event) => {
		event.preventDefault();
		leave();
	}}
	onclick={(event) => event.target === dialog && leave()}
>
	<div class="dialog-head">
		<h2 {id}>{title}</h2>
		<button
			type="button"
			class="icon-button"
			aria-label="Schließen"
			title="Schließen"
			onclick={leave}><Icon name="close" size={20} /></button
		>
	</div>
	<form method="POST" action={saveTarget ?? deleteTarget} class="form" use:enhance={submit}>
		{@render children()}
		{#if error}<p class="error form-wide" role="alert">{error}</p>{/if}
		<div class="form-actions">
			{#if action}<button type="submit">Speichern</button>{/if}
			<a
				href={close}
				class={['button', action && 'secondary']}
				onclick={(event) => {
					event.preventDefault();
					leave();
				}}>{action ? 'Abbrechen' : 'Schließen'}</a
			>
			{#if deleteAction}
				<button type="submit" class="danger delete" formaction={deleteTarget} formnovalidate
					>Löschen</button
				>
			{/if}
		</div>
	</form>
</dialog>

<style>
	.delete {
		margin-left: auto;
	}
	/* What a row holds when it cannot be changed: term and value in two columns. */
	.form :global(dl.details) {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.5rem 1.5rem;
		margin: 0;
	}
	.form :global(dl.details dt) {
		color: var(--color-muted);
	}
	.form :global(dl.details dd) {
		margin: 0;
	}
</style>
