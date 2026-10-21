<script lang="ts">
	// The frame of every page under /objekte/[id]: heading, address, tab bar. The property comes
	// from +layout.server.ts; child pages read it from the layout data (data.property) and render
	// only h2 sections, no PageHeader. Pages put their primary action buttons in a
	// <div class="toolbar"> below the tabs, not in the PageHeader actions snippet, because every
	// tab has actions of its own.
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Tabs from '#lib/components/Tabs.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const tabs = $derived([
		{ href: `/objekte/${data.property.id}`, label: 'Einheiten' },
		{ href: `/objekte/${data.property.id}/abrechnungskreise`, label: 'Abrechnungskreise' }
	]);
</script>

<PageHeader
	title={data.property.name}
	lead="{data.property.street}, {data.property.postalCode} {data.property.city}"
	back={{ href: '/objekte', label: 'Alle Objekte' }}
/>

<Tabs {tabs} />

{@render children()}
