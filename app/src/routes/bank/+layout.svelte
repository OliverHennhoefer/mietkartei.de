<script lang="ts">
	// The frame of every page under /bank: heading and tab bar. Child pages render only h2
	// sections, no PageHeader (a first h2 that only repeats the tab name is .visually-hidden, as the
	// current tab already shows it), and put their primary action buttons in a <div class="toolbar">
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

<PageHeader title="Bank" />

<Tabs {tabs} />

{@render children()}
