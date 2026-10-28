<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, goto } from '$app/navigation';

	import type { Snippet } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';

	// Editing a row of a list in a dialog over the list: the fields, "Speichern" and "Abbrechen" at
	// the bottom left and "Löschen" set apart at the bottom right. The list opens it with a query
	// parameter (?bearbeiten=<id>), so the back button closes it, a link can lead to it and the
	// server renders it open without JavaScript. Both buttons submit the one form: "Löschen" to
	// `deleteAction`, after a question and without checking the fields. When an action redirects
	// back to the list, the dialog closes.
	let {
		title,
		action,
		deleteAction,
		deleteMessage,
		close,
		children
	}: {
		title: string;
		/** The action that saves the fields. */
		action: string;
		deleteAction: string;
		/** The question before deleting. */
		deleteMessage: string;
		/** The list without the dialog. */
		close: string;
		children: Snippet;
	} = $props();

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
		else goto(close, { replace: true, reset: false });
	}

	const submit: SubmitFunction = ({ submitter, cancel }) => {
		const deleting = submitter?.getAttribute('formaction') === deleteAction;
		if (deleting && !confirm(deleteMessage)) {
			cancel();
			return;
		}
		return async ({ result, update }) => {
			if (result.type === 'redirect') leave();
			else await update();
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
	<form method="POST" {action} class="form" use:enhance={submit}>
		{@render children()}
		<div class="form-actions">
			<button type="submit">Speichern</button>
			<a
				href={close}
				class="button secondary"
				onclick={(event) => {
					event.preventDefault();
					leave();
				}}>Abbrechen</a
			>
			<button type="submit" class="danger delete" formaction={deleteAction} formnovalidate
				>Löschen</button
			>
		</div>
	</form>
</dialog>

<style>
	.delete {
		margin-left: auto;
	}
</style>
