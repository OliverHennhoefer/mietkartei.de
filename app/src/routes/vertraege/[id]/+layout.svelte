<script lang="ts">
	// The frame of every page under /vertraege/[id]: heading, tenants, tab bar. The lease comes from
	// +layout.server.ts; child pages read it from the layout data (data.lease) and render only h2
	// sections, no PageHeader. Pages put their primary action buttons in a <div class="toolbar">
	// below the tabs, not in the PageHeader actions snippet, because every tab has actions of its
	// own.
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Tabs from '#lib/components/Tabs.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { personName } from '#lib/format.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const lead = $derived.by(() => {
		const names = data.lease.tenants.map(personName).join(', ');
		const period =
			`seit ${formatDate(data.lease.startDate)}` +
			(data.lease.endDate ? ` bis ${formatDate(data.lease.endDate)}` : '');
		return names ? `${names} · ${period}` : period;
	});

	const tabs = $derived([
		{ href: `/vertraege/${data.lease.id}`, label: 'Übersicht' },
		{ href: `/vertraege/${data.lease.id}/miethoehe`, label: 'Miethöhe' },
		{ href: `/vertraege/${data.lease.id}/mietkonto`, label: 'Mietkonto' },
		{ href: `/vertraege/${data.lease.id}/kaution`, label: 'Kaution' },
		{ href: `/vertraege/${data.lease.id}/co2`, label: 'CO₂' },
		{ href: `/vertraege/${data.lease.id}/dokumente`, label: 'Dokumente' },
		{ href: `/vertraege/${data.lease.id}/mieterportal`, label: 'Mieterportal' }
	]);
</script>

<PageHeader
	title={data.leaseLabel}
	{lead}
	back={{ href: '/vertraege', label: 'Alle Mietverträge' }}
/>

<Tabs {tabs} />

{@render children()}
