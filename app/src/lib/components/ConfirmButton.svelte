<script lang="ts">
	import { enhance } from '$app/forms';

	// A POST form with one button that asks before submitting, for deleting. Without JavaScript
	// the form submits directly.
	let { action, label, message }: { action: string; label: string; message: string } = $props();
</script>

<form
	method="POST"
	{action}
	class="confirm"
	use:enhance={({ cancel }) => {
		if (!confirm(message)) cancel();
	}}
>
	<button type="submit" class="danger">{label}</button>
</form>

<style>
	.confirm {
		display: inline;
	}
</style>
