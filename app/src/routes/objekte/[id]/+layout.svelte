<script lang="ts">
	// The frame of every page under /objekte/[id]: heading, address, tab bar. The property comes
	// from +layout.server.ts; child pages read it from the layout data (data.property) and render
	// only h2 sections, no PageHeader; a first h2 that only repeats the tab name is .visually-hidden,
	// as the current tab already shows it. The create action of each tab sits at the right of the
	// heading, next to "Bearbeiten"; it is set here, by the current path, and leads to the tab's form
	// further down.
	import { page } from '$app/state';
	import CreateButton from '#lib/components/CreateButton.svelte';
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

	const create = $derived.by(() => {
		const base = `/objekte/${data.property.id}`;
		const creates: Record<string, { href: string; label: string }> = {
			[base]: { href: '#einheit-anlegen', label: 'Einheit anlegen' },
			[`${base}/zaehler`]: { href: '#zaehler-anlegen', label: 'Zähler anlegen' },
			[`${base}/abrechnungskreise`]: {
				href: '#abrechnungskreis-anlegen',
				label: 'Abrechnungskreis anlegen'
			},
			[`${base}/versicherungen`]: { href: '#versicherung-anlegen', label: 'Versicherung anlegen' },
			[`${base}/hausgeld`]: {
				href: '#hausgeldabrechnung-erfassen',
				label: 'Hausgeldabrechnung erfassen'
			}
		};
		return creates[page.url.pathname];
	});
	// "Bearbeiten" edits the property, so it shows on the tabs, not on a unit or a form below them.
	const onTab = $derived(tabs.some((tab) => tab.href === page.url.pathname));

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
>
	{#snippet actions()}
		{#if onTab}
			<a class="button secondary" href="/objekte/{data.property.id}/bearbeiten">Bearbeiten</a>
		{/if}
		{#if create}<CreateButton {...create} />{/if}
	{/snippet}
</PageHeader>

<Tabs {tabs} />

{@render children()}
