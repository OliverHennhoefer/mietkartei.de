<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';

	const entries = [
		{
			href: '/einstellungen/profil',
			label: 'Profil',
			text: 'Der Absender (Vermieter) auf deinen Briefen.'
		},
		{
			href: '/bank/konten',
			label: 'Bankverbindungen',
			text: 'Deine Konten, auf die Mieten eingehen.'
		},
		{
			href: '/einstellungen/vpi',
			label: 'Verbraucherpreisindex',
			text: 'Indexwerte für Indexmietverträge.'
		}
	];
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
