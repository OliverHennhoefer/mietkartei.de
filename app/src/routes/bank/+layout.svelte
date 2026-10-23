<script lang="ts">
	// The frame of every page under /bank: heading and tab bar. Child pages render only h2
	// sections, no PageHeader, and put their primary action buttons in a <div class="toolbar">
	// below the tabs, not in the PageHeader actions snippet, because every tab has actions of its
	// own.
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
</script>

<PageHeader title="Bank" lead="Umsätze importieren und Mietverträgen oder Ausgaben zuordnen." />

<Tabs {tabs} />

{@render children()}
