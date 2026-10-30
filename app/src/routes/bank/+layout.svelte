<script lang="ts">
	// The frame of every page under /bank: heading and tab bar. Child pages render only h2
	// sections, no PageHeader (a first h2 that only repeats the tab name is .visually-hidden, as the
	// current tab already shows it), and put their other action buttons in a <div class="toolbar">
	// below the tabs. The create action of a tab sits at the right of the heading; it is set here,
	// by the current path, and leads to the tab's form further down.
	import { page } from '$app/state';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Tabs from '#lib/components/Tabs.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/bank', label: 'Umsätze' },
		{ href: '/bank/import', label: 'Import' },
		{ href: '/bank/regeln', label: 'Regeln' },
		{ href: '/bank/konten', label: 'Konten' }
	];

	const create = $derived.by(() => {
		switch (page.url.pathname) {
			case '/bank/regeln':
				return { href: '#regel-anlegen', label: 'Regel anlegen' };
			case '/bank/konten':
				// Only the landlord manages bank accounts; a co-manager sees no form there.
				return (page.data as { ownerOnly?: boolean }).ownerOnly
					? undefined
					: { href: '#bankverbindung-anlegen', label: 'Bankverbindung anlegen' };
		}
	});
</script>

<PageHeader title="Bank">
	{#snippet actions()}
		{#if create}<CreateButton {...create} />{/if}
	{/snippet}
</PageHeader>

<Tabs {tabs} />

{@render children()}
