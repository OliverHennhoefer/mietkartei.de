<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';

	// A POST form with one button that asks before submitting, for deleting and ending.
	// Hidden inputs can be passed as children. Without JavaScript the form submits directly.
	// With `card`, the form is a form card and the button sits inside it, below the fields.
	let {
		action,
		label,
		message,
		tone = 'danger',
		card = false,
		children
	}: {
		action: string;
		label: string;
		message: string;
		tone?: 'danger' | 'primary' | 'secondary';
		card?: boolean;
		children?: Snippet;
	} = $props();
</script>

<form
	method="POST"
	{action}
	class={card ? 'card form' : 'confirm'}
	use:enhance={({ cancel }) => {
		if (!confirm(message)) cancel();
	}}
>
	{#if children}{@render children()}{/if}
	{#if card}
		<div class="form-actions">
			<button type="submit" class={tone}>{label}</button>
		</div>
	{:else}
		<button type="submit" class={tone}>{label}</button>
	{/if}
</form>

<style>
	.confirm {
		display: inline;
	}
</style>
