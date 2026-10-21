<script lang="ts">
	// The frame of every page under /objekte/[id]: heading and address. The property comes from
	// +layout.server.ts; child pages read it from the layout data (data.property) and render only
	// h2 sections, no PageHeader. Pages put their action buttons in a <div class="toolbar">.
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<PageHeader
	title={data.property.name}
	lead="{data.property.street}, {data.property.postalCode} {data.property.city}"
	back={{ href: '/objekte', label: 'Alle Objekte' }}
/>

{@render children()}
