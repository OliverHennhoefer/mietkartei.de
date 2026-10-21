<script lang="ts">
	import type { Snippet } from 'svelte';

	// A small status label: "Entwurf", "Freigegeben", "Rückstand".
	let {
		tone = 'neutral',
		children
	}: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: Snippet } = $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
	.badge {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 500;
		white-space: nowrap;
		background: #ececea;
		color: var(--color-text);
	}
	.success {
		background: #dcf3e4;
		color: #14532d;
	}
	.warning {
		background: #fdecc8;
		color: #7c3e00;
	}
	.danger {
		background: #fbe0dd;
		color: #8a1c13;
	}
	.info {
		background: #dfeafc;
		color: #1e3a8a;
	}
</style>
