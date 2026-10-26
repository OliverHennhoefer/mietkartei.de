<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';

	// A POST form with one button that asks before submitting, for deleting and ending.
	// Hidden inputs can be passed as children. Without JavaScript the form submits directly.
	let {
		action,
		label,
		message,
		tone = 'danger',
		small = false,
		children
	}: {
		action: string;
		label: string;
		message: string;
		tone?: 'danger' | 'primary' | 'secondary';
		/** The size of the other buttons in a table row. */
		small?: boolean;
		children?: Snippet;
	} = $props();
</script>

<form
	method="POST"
	{action}
	class="confirm"
	use:enhance={({ cancel }) => {
		if (!confirm(message)) cancel();
	}}
>
	{#if children}{@render children()}{/if}
	<button type="submit" class={[tone, small && 'small']}>{label}</button>
</form>

<style>
	.confirm {
		display: inline;
	}
</style>
