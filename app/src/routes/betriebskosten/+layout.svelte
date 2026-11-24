<script lang="ts">
	// The frame of every page under /betriebskosten: heading and tab bar. Child pages render only
	// h2 sections, no PageHeader (a first h2 that only repeats the tab name is .visually-hidden, as the
	// current tab already shows it). The create action of each tab sits at the right of the heading;
	// it is set here, by the current path, and opens the tab's create dialog (?neu) or its own page.
	import { page } from '$app/state';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Tabs from '#lib/components/Tabs.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/betriebskosten', label: 'Abrechnungen' },
		{ href: '/betriebskosten/belege', label: 'Belege' },
		{ href: '/betriebskosten/kostenarten', label: 'Kostenarten' },
		{ href: '/betriebskosten/schluessel', label: 'Umlageschlüssel' }
	];

	// ?neu opens the create dialog of the tab; the tab's filters stay in the query.
	const neu = $derived(page.url.search ? `${page.url.search}&neu` : '?neu');
	const create = $derived.by(() => {
		switch (page.url.pathname) {
			case '/betriebskosten':
				return { href: neu, label: 'Abrechnung erstellen' };
			case '/betriebskosten/belege': {
				// The new receipt starts with the property and year of the current filter.
				const filter = page.data as { property?: { id: string } | null; year?: number | null };
				const query = [
					filter.property ? `property=${encodeURIComponent(filter.property.id)}` : '',
					filter.year != null ? `year=${filter.year}` : ''
				]
					.filter(Boolean)
					.join('&');
				return {
					href: `/betriebskosten/belege/neu${query ? `?${query}` : ''}`,
					label: 'Beleg erfassen'
				};
			}
			case '/betriebskosten/kostenarten':
				return { href: neu, label: 'Kostenart anlegen' };
			case '/betriebskosten/schluessel':
				return { href: neu, label: 'Umlageschlüssel anlegen' };
		}
	});
</script>

<PageHeader title="Betriebskosten" {tabs}>
	{#snippet actions()}
		{#if create}<CreateButton {...create} data-sveltekit-reset={false} />{/if}
	{/snippet}
</PageHeader>

<Tabs {tabs} />

{@render children()}
