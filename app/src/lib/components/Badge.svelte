<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	// A small status label: "Entwurf", "Freigegeben", "Rückstand".
	let {
		tone = 'neutral',
		children
	}: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: Snippet } = $props();
</script>

<span class="badge {tone}">
	{#if tone === 'success'}<Icon
			name="check"
			size={11}
		/>{:else if tone === 'warning' || tone === 'danger'}<Icon name="alert" size={11} />{/if}
	{@render children()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 500;
		white-space: nowrap;
		background: var(--color-subtle);
		color: var(--color-muted);
	}
	.success {
		color: var(--color-text);
	}
	.warning {
		background: var(--color-hover);
		color: var(--color-text);
	}
	.danger {
		background: var(--color-danger-subtle);
		border-color: var(--color-danger-border);
		color: var(--color-danger);
	}
	.info {
		color: var(--color-text);
	}
</style>
