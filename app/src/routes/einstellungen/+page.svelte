<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Entries a manager may not open (requireOwner answers 403) are left out for them, the
	// subscription where the instance has none.
	const allEntries = [
		{
			href: '/einstellungen/profil',
			label: 'Profil',
			text: 'Name, E-Mail-Adresse, Passwort und der Absender (Vermieter) auf deinen Briefen.'
		},
		{
			href: '/einstellungen/mitverwalter',
			label: 'Mitverwalter',
			text: 'Weitere Personen einladen, die deinen Bestand mit verwalten.',
			ownerOnly: true
		},
		{
			href: '/bank/konten',
			label: 'Bankverbindungen',
			text: 'Deine Konten, auf die Mieten eingehen.'
		},
		{
			href: '/betriebskosten/kostenarten',
			label: 'Kostenarten',
			text: 'Welche Kosten du umlegst, nach § 2 Betriebskostenverordnung.'
		},
		{
			href: '/betriebskosten/schluessel',
			label: 'Umlageschlüssel',
			text: 'Nach Fläche, Personen, Einheiten oder Verbrauch.'
		},
		{
			href: '/einstellungen/vpi',
			label: 'Verbraucherpreisindex',
			text: 'Indexwerte für Indexmietverträge.'
		},
		{
			href: '/einstellungen/export',
			label: 'Export',
			text: 'Alle Daten als Datei herunterladen.',
			ownerOnly: true
		},
		{
			href: '/einstellungen/protokoll',
			label: 'Protokoll',
			text: 'Wer wann was geändert hat.'
		},
		{
			href: '/abo',
			label: 'Abo',
			text: 'Testphase, Abo und Zahlung der gehosteten Variante.',
			billingOnly: true
		},
		{ href: '/einstellungen/konto', label: 'Konto', text: 'Konto und alle Daten löschen.' }
	];
	const entries = $derived(
		allEntries.filter(
			(entry) =>
				(data.role === 'owner' || !entry.ownerOnly) && (data.billingEnabled || !entry.billingOnly)
		)
	);
</script>

<PageHeader title="Einstellungen" />

<ul class="list" aria-label="Einstellungen">
	{#each entries as entry (entry.href)}
		<li class="card">
			<a href={entry.href}><strong>{entry.label}</strong></a>
			<span class="muted">{entry.text}</span>
		</li>
	{/each}
</ul>
