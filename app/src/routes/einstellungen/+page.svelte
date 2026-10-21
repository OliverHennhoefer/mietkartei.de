<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Entries a manager may not open (requireOwner answers 403) are left out for them.
	const allEntries = [
		{ href: '/einstellungen/profil', label: 'Profil', text: 'Name, E-Mail-Adresse und Passwort.' },
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
			href: '/import',
			label: 'Datenübernahme',
			text: 'Objekte, Mieter, Mietverträge und Zahlungen aus einer CSV-Datei übernehmen.'
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
		{ href: '/einstellungen/konto', label: 'Konto', text: 'Konto und alle Daten löschen.' }
	];
	const entries = $derived(
		data.role === 'owner' ? allEntries : allEntries.filter((entry) => !entry.ownerOnly)
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
	{#if data.billingEnabled}
		<li class="card">
			<a href="/abo"><strong>Abo</strong></a>
			<span class="muted">Dein Abo der gehosteten Variante.</span>
		</li>
	{/if}
</ul>
