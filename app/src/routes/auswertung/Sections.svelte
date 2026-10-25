<script lang="ts">
	import Tabs from '#lib/components/Tabs.svelte';

	// The pages of the Auswertung, below each page's heading; the sidebar links only the first.
	const tabs = [
		{ href: '/auswertung', label: 'Überblick' },
		{ href: '/auswertung/rendite', label: 'Rendite' },
		{ href: '/auswertung/mieteinnahmen', label: 'Mieteinnahmen' },
		{ href: '/auswertung/ausgaben', label: 'Ausgaben' },
		{ href: '/auswertung/nebenkosten', label: 'Nebenkosten' },
		{ href: '/auswertung/prognose', label: 'Prognose' },
		{ href: '/auswertung/vergleich', label: 'Vergleich' }
	];
</script>

<Tabs {tabs} label="Auswertung" />
