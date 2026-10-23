<script lang="ts">
	// The frame of every page under /auswertung: heading and tab bar. Child pages render only h2
	// sections, as under /bank.
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Tabs from '#lib/components/Tabs.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/auswertung', label: 'Übersicht' },
		{ href: '/auswertung/ausgaben', label: 'Ausgaben' }
	];
</script>

<PageHeader
	title="Auswertung"
	lead="Einnahmen, Ausgaben und Leerstand deines Bestands, je Objekt und Einheit."
/>

<Tabs {tabs} />

{@render children()}
