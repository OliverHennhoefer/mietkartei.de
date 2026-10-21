<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
</script>

<PageHeader
	title="Export"
	lead="Alle Daten deines Kontos als eine Datei."
	back={{ href: '/einstellungen', label: 'Einstellungen' }}
/>

<section class="card export">
	<p>
		Der Export ist eine ZIP-Datei mit allen Daten deines Kontos als JSON (<code>export.json</code>)
		und allen hochgeladenen Dokumenten im Ordner <code>documents/</code>. Passwörter sind nicht
		enthalten. Der Export wird im Protokoll vermerkt.
	</p>

	<!-- A download cannot come out of a POST action, so the button is a GET to the download route. -->
	<form method="GET" action="/einstellungen/export/herunterladen">
		<button type="submit">Export herunterladen</button>
	</form>
</section>

<style>
	.export {
		max-width: 45rem;
	}
	.export p {
		margin: 0 0 1.25rem;
	}
	code {
		padding: 0.1rem 0.35rem;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: var(--color-subtle);
		font-size: 0.85em;
	}
</style>
