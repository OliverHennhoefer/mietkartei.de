<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
</script>

<PageHeader title="Export" back={{ href: '/einstellungen', label: 'Einstellungen' }} />

<p>
	Der Export ist eine ZIP-Datei mit allen Daten deines Kontos als JSON (<code>export.json</code>)
	und allen hochgeladenen Dokumenten im Ordner <code>documents/</code>. Passwörter sind nicht
	enthalten. Der Export wird im Protokoll vermerkt.
</p>

<!-- A download cannot come out of a POST action, so the button is a GET to the download route. -->
<form method="GET" action="/einstellungen/export/herunterladen" class="toolbar">
	<button type="submit">Export herunterladen</button>
</form>
