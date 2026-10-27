<script lang="ts">
	import { page } from '$app/state';

	// The one page of the demo meant for search engines and link previews.
	const title = 'Demo ausprobieren | mietkartei';
	const description =
		'Teste mietkartei, die Open-Source-Hausverwaltung für Privatvermieter, mit eigenem ' +
		'Beispielbestand: Mietkonto, Bankumsätze und Betriebskostenabrechnung. Ohne Anmeldung.';
	const url = $derived(`${page.url.origin}/demo`);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
</svelte:head>

<div class="narrow">
	<h1>mietkartei ausprobieren</h1>
	<p class="auth-lead">
		Du bekommst einen eigenen Beispielbestand: zwei Häuser, fünf Mietverträge, zwei Jahre
		Mietzahlungen, offene Bankumsätze und die Belege für eine Betriebskostenabrechnung. Ändere,
		lösche und rechne nach Belieben; nach 24 Stunden wird alles gelöscht.
	</p>
	<form method="POST" class="card">
		<p>Ohne Anmeldung, ohne E-Mail-Adresse. Gib in der Demo bitte keine echten Daten ein.</p>
		<div class="form-actions">
			<button type="submit">Demo starten</button>
			<a href="https://mietkartei.de/fragen/" class="small">Fragen?</a>
		</div>
	</form>
</div>
