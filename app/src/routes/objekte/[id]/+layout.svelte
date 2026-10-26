<script lang="ts">
	// The frame of every page under /objekte/[id]: heading, address, tab bar. The property comes
	// from +layout.server.ts; child pages read it from the layout data (data.property) and render
	// only h2 sections, no PageHeader. Pages put their primary action buttons in a
	// <div class="toolbar"> below the tabs, not in the PageHeader actions snippet, because every
	// tab has actions of its own.
	import { formatDate } from '#lib/dates.ts';
	import { formatNumber } from '#lib/format.ts';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Tabs from '#lib/components/Tabs.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const tabs = $derived([
		{
			href: `/objekte/${data.property.id}`,
			label: 'Einheiten',
			also: [`/objekte/${data.property.id}/einheiten`]
		},
		{ href: `/objekte/${data.property.id}/zaehler`, label: 'Zähler' },
		{ href: `/objekte/${data.property.id}/abrechnungskreise`, label: 'Abrechnungskreise' },
		{ href: `/objekte/${data.property.id}/versicherungen`, label: 'Versicherungen' },
		...(data.property.kind === 'condominium'
			? [{ href: `/objekte/${data.property.id}/hausgeld`, label: 'Hausgeld' }]
			: []),
		{ href: `/objekte/${data.property.id}/steuer`, label: 'Steuer' },
		{ href: `/objekte/${data.property.id}/lage`, label: 'Lage' }
	]);

	/** For an Eigentumswohnung: the WEG, its MEA and its Verwalter. */
	const condominium = $derived.by(() => {
		const property = data.property;
		if (property.kind !== 'condominium') return '';
		const parts = ['Eigentumswohnung in einer WEG'];
		if (property.ownershipShare !== null && property.ownershipShareTotal !== null) {
			parts.push(
				`MEA ${formatNumber(property.ownershipShare)} von ${formatNumber(property.ownershipShareTotal)}`
			);
		}
		if (property.associationManager) parts.push(`Verwalter ${property.associationManager}`);
		return ` · ${parts.join(', ')}`;
	});
</script>

<PageHeader
	title={data.property.name}
	lead="{data.property.street}, {data.property.postalCode} {data.property.city}{condominium}{data
		.property.archivedAt
		? ` · archiviert am ${formatDate(data.property.archivedAt)}`
		: ''}"
	back={{ href: '/objekte', label: 'Alle Objekte' }}
/>

<Tabs {tabs} />

{@render children()}
