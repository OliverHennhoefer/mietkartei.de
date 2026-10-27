<script lang="ts">
	import { page } from '$app/state';

	// Links styled as tabs. The tab whose href matches the current path (or is its prefix for
	// nested pages) is marked current; the first tab only matches exactly, as it is the overview.
	// `also` lists further path prefixes a tab owns, e.g. the unit pages below an overview tab.
	type Tab = { href: string; label: string; also?: string[] };
	let { tabs, label = 'Bereiche' }: { tabs: Tab[]; label?: string } = $props();

	const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

	function isCurrent(tab: Tab, index: number): boolean {
		const path = page.url.pathname;
		if (tab.also?.some((prefix) => within(path, prefix))) return true;
		return index === 0 ? path === tab.href : within(path, tab.href);
	}

	// On a narrow screen the tabs scroll sideways; the current one is scrolled into sight.
	let nav = $state<HTMLElement>();
	$effect(() => {
		void page.url.pathname;
		const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!nav || !current) return;
		const left = current.offsetLeft - nav.offsetLeft;
		if (left < nav.scrollLeft || left + current.offsetWidth > nav.scrollLeft + nav.clientWidth)
			nav.scrollLeft = left - (nav.clientWidth - current.offsetWidth) / 2;
	});
</script>

<nav bind:this={nav} class="tabs" aria-label={label}>
	{#each tabs as tab, index (tab.href)}
		<a href={tab.href} aria-current={isCurrent(tab, index) ? 'page' : undefined}>
			{tab.label}
		</a>
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		gap: 1.5rem;
		overflow-x: auto;
		border-bottom: 1px solid var(--color-border);
		margin: 0 0 2rem;
	}
	.tabs a {
		padding: 0.75rem 0 1rem;
		font-size: var(--text-sm);
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
	.tabs a:hover {
		color: var(--color-text);
	}
</style>
