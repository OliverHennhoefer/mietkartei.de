<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// A message box above a form or list, announced as an alert for errors and as a status else.
	// `role="note"` is for a standing remark that is not news, such as the billing notice.
	let {
		tone = 'info',
		role,
		children
	}: {
		tone?: 'info' | 'success' | 'warning' | 'danger';
		role?: 'note';
		children: Snippet;
	} = $props();
</script>

<div class="alert {tone}" role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
	<Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'} size={18} />
	<div>{@render children()}</div>
</div>

<style>
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		background: var(--color-subtle);
		margin: 0 0 1.5rem;
		font-size: var(--text-base);
	}
	.alert :global(.icon) {
		margin-top: 0.2rem;
	}
	.alert > div {
		min-width: 0;
	}
	.alert :global(p) {
		margin: 0;
	}
	.danger {
		border-color: var(--color-danger-border);
		background: var(--color-danger-subtle);
	}
	.danger :global(.icon) {
		color: var(--color-danger);
	}
	.success :global(.icon) {
		color: var(--color-success);
	}
</style>
