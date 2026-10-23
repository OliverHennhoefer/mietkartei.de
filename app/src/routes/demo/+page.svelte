<script lang="ts">
	import { page } from '$app/state';
	import Icon from '#lib/components/Icon.svelte';

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
	<meta property="og:site_name" content="mietkartei" />
	<meta property="og:locale" content="de_DE" />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content="https://mietkartei.de/assets/social.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="narrow">
	<div class="auth-icon"><Icon name="home" size={25} /></div>
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
			<a href="https://mietkartei.de" class="small">Mehr über mietkartei</a>
		</div>
	</form>
</div>
