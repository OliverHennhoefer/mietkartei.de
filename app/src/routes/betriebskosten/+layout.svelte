<script lang="ts">
	// The frame of every page under /betriebskosten: heading and tab bar. Child pages render only
	// h2 sections, no PageHeader (a first h2 that only repeats the tab name is .visually-hidden, as the
	// current tab already shows it). The create action of each tab sits at the right of the heading;
	// it is set here, by the current path, and leads to the tab's form further down or its own page.
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

	const create = $derived.by(() => {
		switch (page.url.pathname) {
			case '/betriebskosten':
				return { href: '#neue-abrechnung', label: 'Abrechnung erstellen' };
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
				return { href: '#kostenart-anlegen', label: 'Kostenart anlegen' };
			case '/betriebskosten/schluessel':
				return { href: '#umlageschluessel-anlegen', label: 'Umlageschlüssel anlegen' };
		}
	});
</script>

<PageHeader title="Betriebskosten">
	{#snippet actions()}
		{#if create}<CreateButton {...create} />{/if}
	{/snippet}
</PageHeader>

<Tabs {tabs} />

{@render children()}
