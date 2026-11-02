<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import FieldLabel from './FieldLabel.svelte';
	import Icon from './Icon.svelte';

	// A password input with an eye button that shows what was typed. The button sits outside the
	// label: inside it, its name would become part of the input's name. The note and the error are
	// the input's description instead.
	let {
		label,
		note,
		error,
		subject = 'Passwort',
		...input
	}: {
		label: string;
		note?: string;
		error?: string;
		/** What the button shows or hides, as in "Passwort anzeigen". */
		subject?: string;
	} & Omit<HTMLInputAttributes, 'id' | 'type' | 'aria-describedby'> = $props();

	const id = $props.id();
	let shown = $state(false);
	let field: HTMLInputElement | undefined = $state();

	const describedBy = $derived(
		[note && `${id}-note`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
	);

	// Hidden again on submit, so no browser keeps the password as a plain text entry.
	$effect(() => {
		const form = field?.form;
		if (!form) return;
		const hide = () => {
			shown = false;
		};
		form.addEventListener('submit', hide);
		return () => form.removeEventListener('submit', hide);
	});
</script>

<div class="password-field">
	<label for="{id}-input"><FieldLabel {label} /></label>
	<div class="password-below">
		<div class="password-control">
			<input
				bind:this={field}
				{...input}
				id="{id}-input"
				type={shown ? 'text' : 'password'}
				aria-describedby={describedBy}
				autocapitalize="none"
				spellcheck="false"
			/>
			<button
				type="button"
				class="password-toggle"
				aria-controls="{id}-input"
				title="{subject} {shown ? 'verbergen' : 'anzeigen'}"
				onclick={() => (shown = !shown)}
			>
				<Icon name={shown ? 'eye-off' : 'eye'} />
				<span class="sr-only">{subject} {shown ? 'verbergen' : 'anzeigen'}</span>
			</button>
		</div>
		{#if note}<span class="muted" id="{id}-note">{note}</span>{/if}
		{#if error}<span class="error" id="{id}-error">{error}</span>{/if}
	</div>
</div>

<style>
	/* Laid out like Field: in the shared form grid it spans the row of titles and the row of
	   controls, so its input lines up with the inputs beside it. */
	.password-field {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		font-weight: 500;
		font-size: var(--text-sm);
	}
	:global(:is(form.card, .form)) > .password-field {
		grid-row: span 2;
		grid-template-rows: subgrid;
	}
	.password-field > label {
		align-self: end;
	}
	.password-below {
		display: grid;
		align-self: start;
		gap: 0.5rem;
		min-width: 0;
	}
	.password-control {
		position: relative;
		display: grid;
	}
	.password-control input {
		padding-right: 3rem;
	}
	/* Edge brings its own reveal button. */
	.password-control input::-ms-reveal {
		display: none;
	}
	.password-toggle {
		position: absolute;
		top: 50%;
		right: 0.25rem;
		translate: 0 -50%;
		width: 2.5rem;
		height: 2.25rem;
		min-height: 0;
		padding: 0;
		border-color: transparent;
		background: transparent;
		color: var(--color-muted);
	}
	.password-toggle:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}
	.password-toggle:focus-visible {
		outline-offset: 0;
	}
</style>
