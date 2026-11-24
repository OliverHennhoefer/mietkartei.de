<script lang="ts">
	// The frame of every page under /bank: heading and tab bar. Child pages render only h2
	// sections, no PageHeader (a first h2 that only repeats the tab name is .visually-hidden, as the
	// current tab already shows it), and put their other action buttons in a <div class="toolbar">
	// below the tabs. The create action of a tab sits at the right of the heading; it is set here,
	// by the current path, and opens the tab's create dialog (?neu).
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
		{ href: '/bank/gegenkonten', label: 'Gegenkonten' },
		{ href: '/bank/datev', label: 'DATEV' },
		{ href: '/bank/konten', label: 'Konten' }
	];

	// ?neu opens the create dialog of the tab; the tab's filters stay in the query.
	const neu = $derived(page.url.search ? `${page.url.search}&neu` : '?neu');
	const create = $derived.by(() => {
		switch (page.url.pathname) {
			case '/bank/regeln':
				return { href: neu, label: 'Regel anlegen' };
			case '/bank/gegenkonten':
				return { href: neu, label: 'Gegenkonto anlegen' };
			case '/bank/konten':
				// Only the landlord manages bank accounts; a co-manager sees no form there.
				return (page.data as { ownerOnly?: boolean }).ownerOnly
					? undefined
					: { href: neu, label: 'Bankverbindung anlegen' };
		}
	});
</script>

<PageHeader title="Bank" {tabs}>
	{#snippet actions()}
		{#if create}<CreateButton {...create} data-sveltekit-reset={false} />{/if}
	{/snippet}
</PageHeader>

<Tabs {tabs} />

{@render children()}
