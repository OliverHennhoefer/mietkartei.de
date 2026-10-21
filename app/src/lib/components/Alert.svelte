<script lang="ts">
	import type { Snippet } from 'svelte';

	// A message box above a form or list. `status` for results, `alert` for errors; a standing
	// banner that is part of the page (not a live region) passes role="note".
	let {
		tone = 'info',
		role,
		children
	}: {
		tone?: 'info' | 'success' | 'warning' | 'danger';
		role?: 'status' | 'alert' | 'note';
		children: Snippet;
	} = $props();
</script>

<div class="alert {tone}" role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
	{@render children()}
</div>

<style>
	.alert {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		margin: 0 0 1rem;
	}
	.alert :global(p) {
		margin: 0;
	}
	.info {
		border-color: #b9cdf5;
		background: #eef3fd;
	}
	.success {
		border-color: #a7dcb9;
		background: #ebf8ef;
	}
	.warning {
		border-color: #f3cf8f;
		background: #fef5e6;
	}
	.danger {
		border-color: #efb0aa;
		background: #fdeeec;
	}
</style>
