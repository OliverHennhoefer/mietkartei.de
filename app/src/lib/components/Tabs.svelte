<script lang="ts">
	import { page } from '$app/state';

	// Links styled as tabs. The tab whose href matches the current path (or is its prefix for
	// nested pages) is marked current; the first tab only matches exactly, as it is the overview.
	let { tabs, label = 'Bereiche' }: { tabs: { href: string; label: string }[]; label?: string } =
		$props();

	function isCurrent(href: string, index: number): boolean {
		const path = page.url.pathname;
		if (index === 0) return path === href;
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<nav class="tabs" aria-label={label}>
	{#each tabs as tab, index (tab.href)}
		<a href={tab.href} aria-current={isCurrent(tab.href, index) ? 'page' : undefined}>
			{tab.label}
		</a>
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		border-bottom: 1px solid var(--color-border);
		margin: 0 0 1.5rem;
	}
	.tabs a {
		padding: 0.5rem 0.75rem;
		white-space: nowrap;
		text-decoration: none;
		color: var(--color-muted);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs a[aria-current='page'] {
		color: var(--color-text);
		border-bottom-color: var(--color-accent);
		font-weight: 500;
	}
</style>
