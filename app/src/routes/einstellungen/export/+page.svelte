<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { pluralize } from '#lib/format.ts';
	import { readZip } from '#lib/zip-reader.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Progress =
		| { step: 'idle' }
		| { step: 'running'; text: string }
		| {
				step: 'done';
				rows: number;
				documents: number;
				stored: number;
				present: number;
				failed: string[];
				documentsOnly: boolean;
		  }
		| { step: 'failed'; message: string };

	let progress = $state<Progress>({ step: 'idle' });
	let input: HTMLInputElement | undefined = $state();

	/** Thrown to stop reading the ZIP, with what to show. */
	class Stop extends Error {}

	/** The id in `documents/<id>-<name>`: document ids are UUIDs, 36 characters. */
	const documentId = (path: string) => /^documents\/([0-9a-f-]{36})-/.exec(path)?.[1];

	async function failure(response: Response): Promise<string> {
		try {
			const body = (await response.json()) as { message?: string };
			if (body.message) return body.message;
		} catch {
			// Not JSON: fall through to the status.
		}
		return `Der Server hat mit Status ${response.status} geantwortet.`;
	}

	/**
	 * Sends what the ZIP holds: export.json first (it comes first in the archive), then each
	 * document in its own request, so no request is larger than one document. In an account that
	 * holds data already, only the documents go, so files that failed before can follow later;
	 * files that are there already are skipped.
	 */
	async function restore(file: File) {
		const documentsOnly = !data.canRestore;
		progress = { step: 'running', text: 'Lese die Datei …' };
		let restored: { rows: number; documents: number } | undefined = documentsOnly
			? { rows: 0, documents: 0 }
			: undefined;
		let stored = 0;
		let present = 0;
		const failed: string[] = [];
		try {
			await readZip(file.stream(), async (path, bytes) => {
				if (path === 'export.json') {
					if (documentsOnly) return;
					progress = { step: 'running', text: 'Übernehme die Einträge …' };
					const body = await new Response(
						new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
					).blob();
					const response = await fetch('/einstellungen/export/einspielen', {
						method: 'POST',
						headers: { 'content-type': 'application/gzip' },
						body
					});
					if (!response.ok) throw new Stop(await failure(response));
					restored = await response.json();
					return;
				}
				const id = documentId(path);
				if (!restored || !id) return;
				const done = stored + present + failed.length;
				progress = {
					step: 'running',
					text: documentsOnly
						? `Übernehme Dokument ${done + 1} …`
						: `Übernehme Dokument ${done + 1} von ${restored.documents} …`
				};
				const response = await fetch(`/einstellungen/export/einspielen/${id}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/octet-stream' },
					body: new Blob([bytes])
				});
				if (response.ok) stored += 1;
				else if (response.status === 409) present += 1;
				else failed.push(`${path.slice(`documents/${id}-`.length)}: ${await failure(response)}`);
			});
		} catch (error) {
			const message =
				error instanceof Stop ? error.message : 'Die Datei ist keine lesbare ZIP-Datei.';
			progress = { step: 'failed', message };
			return;
		}
		if (!restored) {
			progress = { step: 'failed', message: 'Die ZIP-Datei enthält keine export.json.' };
			return;
		}
		progress = { step: 'done', ...restored, stored, present, failed, documentsOnly };
	}

	function start(event: SubmitEvent) {
		event.preventDefault();
		const file = input?.files?.[0];
		if (file) void restore(file);
	}
</script>

<PageHeader title="Export" />

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

<section class="card export" aria-labelledby="einspielen">
	<h2 id="einspielen">Export einspielen</h2>
	<p>
		Du ziehst um, etwa von app.mietkartei.de auf deinen eigenen Server oder zurück? Lade dort den
		Export herunter und spiele ihn hier ein. Objekte, Mieter, Verträge, Mietkonten, Abrechnungen,
		Dokumente und das Protokoll kommen vollständig mit. Mitverwalter lädst du danach neu ein.
	</p>

	{#if progress.step === 'done'}
		<Alert tone={progress.failed.length > 0 ? 'warning' : 'success'}>
			<p>
				{#if progress.documentsOnly}
					{pluralize(progress.stored, 'Dokument', 'Dokumente')} nachgereicht, {progress.present} schon
					vorhanden.
				{:else}
					{progress.rows} Einträge und {progress.stored} von {progress.documents} Dokumenten übernommen.
				{/if}
			</p>
			{#if progress.failed.length > 0}
				<ul>
					{#each progress.failed as line (line)}<li>{line}</li>{/each}
				</ul>
			{/if}
		</Alert>
		<p class="next"><a class="button" href="/objekte">Zu den Objekten</a></p>
	{:else}
		{#if !data.canRestore}
			<Alert tone="info" role="note">
				<p>
					Dein Konto enthält schon Objekte oder Dokumente. Ein Export lässt sich nur in ein leeres
					Konto einspielen, damit nichts verloren geht. Fehlen nach dem Einspielen Dokumente, wähle
					die Exportdatei noch einmal: Dann werden nur die fehlenden Dokumente nachgereicht.
				</p>
			</Alert>
		{/if}
		{#if progress.step === 'failed'}
			<Alert tone="danger"><p>{progress.message}</p></Alert>
		{/if}
		<noscript>
			<Alert tone="warning"><p>Zum Einspielen braucht diese Seite JavaScript.</p></Alert>
		</noscript>
		<form onsubmit={start}>
			<label for="restore-file">Exportdatei (ZIP)</label>
			<input
				id="restore-file"
				type="file"
				accept=".zip,application/zip"
				required
				bind:this={input}
				disabled={progress.step === 'running'}
			/>
			<button type="submit" disabled={progress.step === 'running'}>
				{data.canRestore ? 'Export einspielen' : 'Dokumente nachreichen'}
			</button>
		</form>
		{#if progress.step === 'running'}
			<p class="status" role="status">{progress.text}</p>
		{/if}
	{/if}
</section>

<style>
	.export {
		max-width: 45rem;
	}
	.export + .export {
		margin-top: 1.5rem;
	}
	.export h2 {
		margin: 0 0 0.75rem;
	}
	.export p {
		margin: 0 0 1.25rem;
	}
	.export form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.export label {
		flex-basis: 100%;
		font-weight: 600;
	}
	.status {
		margin-top: 1rem;
	}
	.next {
		margin-top: 1rem;
	}
	code {
		padding: 0.1rem 0.35rem;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: var(--color-subtle);
		font-size: 0.85em;
	}
</style>
