<script lang="ts">
	// The frame of every page under /betriebskosten: heading and tab bar. Child pages render only
	// h2 sections, no PageHeader, and put their primary action buttons in a <div class="toolbar">
	// below the tabs, not in the PageHeader actions snippet, because every tab has actions of its
	// own.
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
</script>

<PageHeader
	title="Betriebskosten"
	lead="Belege sammeln, Zählerstände erfassen, Abrechnung erstellen."
/>

<Tabs {tabs} />

{@render children()}
