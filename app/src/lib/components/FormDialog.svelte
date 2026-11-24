<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	import { tick, type Snippet } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';

	// A new or existing row of a list in a dialog over the list: its fields, the submit button and
	// "Abbrechen" at the bottom left and "Löschen" set apart at the bottom right. A row that cannot
	// be changed shows what it holds instead (no `action`), one that cannot be deleted has no
	// "Löschen". The list opens it with a query parameter (?neu, ?bearbeiten=<id>), so the back
	// button closes it, a link can lead to it and the server renders it open without JavaScript.
	// Both buttons submit the one form: "Löschen" to `deleteAction`, after a question and without
	// checking the fields. When an action succeeds, the dialog closes: after a redirect back to the
	// list, or after an answer with data, which goes to `onsaved` first.
	let {
		title,
		action,
		deleteAction,
		deleteMessage,
		close,
		error,
		submitLabel = 'Speichern',
		submitMessage,
		onsaved,
		children
	}: {
		title: string;
		/** The action that saves the fields; without it the dialog only shows the row. */
		action?: string;
		/** The submit button, such as "Dienstleister anlegen" in a dialog that creates a row. */
		submitLabel?: string;
		/** The question before saving, for a step such as ending a lease. */
		submitMessage?: string;
		/** Receives what a successful action answers instead of a redirect, before the dialog closes. */
		onsaved?: (data: Record<string, unknown> | undefined) => void;
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

	// Made modal once the surrounding effects have run: a dialog over a page in the settings dialog
	// has to open after that one, or the settings would cover it.
	$effect(() => {
		const opened = dialog;
		if (!opened) return;
		tick().then(() => {
			if (!opened.isConnected || opened.matches(':modal')) return;
			opened.close();
			opened.showModal();
		});
	});

	function leave() {
		if (fromList) history.back();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the list page's own path
		else goto(close, { replace: true, reset: false });
	}

	/** Whether a redirect names the list, maybe with less of its query. */
	function leadsToList(location: string) {
		const target = new URL(location, page.url.href);
		const list = new URL(close, page.url.href);
		return (
			target.pathname === list.pathname &&
			[...target.searchParams].every(([name, value]) => list.searchParams.get(name) === value)
		);
	}

	const submit: SubmitFunction = ({ submitter, cancel }) => {
		const deleting = submitter?.getAttribute('formaction') === deleteTarget;
		const question = deleting ? deleteMessage : submitMessage;
		if (question && !confirm(question)) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			if (result.type === 'success') {
				await invalidateAll();
				onsaved?.(result.data);
				leave();
			} else if (result.type === 'redirect') {
				// A redirect elsewhere than the list, such as the year an expense moved to, is followed.
				if (!leadsToList(result.location)) {
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- the action's redirect
					await goto(result.location, { replace: true });
					return;
				}
				// The list loads again for the page it is on, without the row, before the dialog goes.
				await invalidateAll();
				leave();
			} else await update();
		};
	};
</script>

<dialog
	bind:this={dialog}
	class="form-dialog"
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
			{#if action}<button type="submit">{submitLabel}</button>{/if}
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
