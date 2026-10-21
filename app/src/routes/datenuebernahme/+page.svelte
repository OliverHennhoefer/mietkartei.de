<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Field from '#lib/components/Field.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Step 1 (the upload form, also after a form error), step 2 (mapping and preview) or the summary.
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const preview = $derived(form && 'step' in form && form.step === 'preview' ? form : undefined);
	const summary = $derived(
		form && 'step' in form && form.step === 'done' ? form.summary : undefined
	);

	const selectedKind = $derived(
		data.kinds.find((kind) => kind === values?.kind) ??
			preview?.kind ??
			summary?.kind ??
			'properties'
	);
	const fields = $derived(data.fields[selectedKind]);
	/** The preview table shows only the fields a column is mapped to. */
	const mappedFields = $derived(
		preview ? fields.filter((field) => preview.mapping[field.name] !== null) : []
	);
	const skippedInPreview = $derived(
		preview ? preview.rows.filter((row) => row.reason !== undefined).length : 0
	);

	const help: Record<string, string> = {
		properties:
			'Eine Zeile je Einheit mit Objekt, Straße, PLZ, Ort, Einheit, Art und Fläche. Zeilen mit demselben Objekt und derselben Straße gehören zu einem Objekt; ein Objekt wird nur wiederverwendet, wenn Name und Adresse übereinstimmen oder ohne Adresse genau ein Objekt so heißt.',
		tenants:
			'Eine Zeile je Mieter mit Anrede, Vorname, Nachname, E-Mail, Telefon und Adresse. Einen Mieter gibt es schon, wenn Name und E-Mail-Adresse übereinstimmen, ohne E-Mail-Adresse Name und Adresse.',
		leases:
			'Eine Zeile je Mietvertrag mit Objekt, Einheit, Mieter („Nachname, Vorname“ oder E-Mail-Adresse, mehrere mit „;“), Beginn, Ende, Kaltmiete, Betriebs- und Heizkostenvorauszahlung, Kaution, Personen, „Mietkonto ab“ und Anfangssaldo. Objekte, Einheiten und Mieter müssen schon angelegt sein.',
		payments:
			'Eine Zeile je Zahlung mit Objekt, Einheit, Datum, Betrag und Verwendungszweck; der Nachname des Mieters, wenn zur Einheit mehrere Mietverträge passen.'
	};
</script>

<PageHeader
	title="Datenübernahme"
	lead="Übernimm Objekte, Mieter, Mietverträge und Zahlungen aus einer CSV-Datei deiner bisherigen Software."
	back={{ href: '/einstellungen', label: 'Einstellungen' }}
/>

{#if summary}
	<Alert tone="success">
		<p>
			<strong>{data.kindLabels[summary.kind]}:</strong>
			{summary.created}{#if summary.skipped.length > 0}, {summary.skipped.length}
				{summary.skipped.length === 1 ? 'Zeile' : 'Zeilen'} übersprungen{/if}.
		</p>
	</Alert>

	{#if summary.skipped.length > 0}
		<h2>Übersprungene Zeilen</h2>
		<div class="table-wrap">
			<table class="table" aria-label="Übersprungene Zeilen">
				<thead>
					<tr><th class="num">Zeile</th><th>Grund</th></tr>
				</thead>
				<tbody>
					{#each summary.skipped as row (row.row)}
						<tr><td class="num">{row.row}</td><td>{row.reason}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="toolbar">
		<a class="button" href="/datenuebernahme">Weitere Datei importieren</a>
		<a class="button secondary" href="/objekte">Zu den Objekten</a>
		<a class="button secondary" href="/mieter">Zu den Mietern</a>
		<a class="button secondary" href="/vertraege">Zu den Mietverträgen</a>
	</div>
{:else if preview}
	{#if preview.message}
		<Alert tone="warning"><p>{preview.message}</p></Alert>
	{/if}

	<h2>Spalten zuordnen</h2>
	<form method="POST" action="?/preview" class="card form-wide" use:enhance>
		<input type="hidden" name="kind" value={preview.kind} />
		<input type="hidden" name="content" value={preview.content} />
		<p class="muted">
			{data.kindLabels[preview.kind]}: {preview.headers.length}
			{preview.headers.length === 1 ? 'Spalte' : 'Spalten'}, {preview.total}
			{preview.total === 1 ? 'Zeile' : 'Zeilen'}. Wähle zu jedem Feld die Spalte der Datei.
		</p>
		<div class="mapping">
			{#each fields as field (field.name)}
				<Field label={field.required ? field.label : `${field.label} (optional)`} hint={field.hint}>
					<select name="map.{field.name}">
						<option value="" selected={preview.mapping[field.name] === null}
							>nicht importieren</option
						>
						{#each preview.headers as header, index (index)}
							<option value={index} selected={preview.mapping[field.name] === index}>
								{header || `Spalte ${index + 1}`}
							</option>
						{/each}
					</select>
				</Field>
			{/each}
		</div>
		<div class="form-actions">
			<button type="submit" class="secondary" formaction="?/preview">Vorschau aktualisieren</button>
			<button type="submit" formaction="?/commit">Importieren</button>
			<a href="/datenuebernahme">Abbrechen</a>
		</div>
	</form>

	<h2>Vorschau</h2>
	<p>
		{preview.planned} von {preview.total}
		{preview.total === 1 ? 'Zeile wird' : 'Zeilen werden'} importiert{#if preview.total > preview.rows.length};
			die Vorschau zeigt die ersten {preview.rows.length}{/if}.
		{#if skippedInPreview > 0}Ungültige Zeilen werden übersprungen.{/if}
	</p>
	<div class="table-wrap">
		<table class="table" aria-label="Vorschau">
			<thead>
				<tr>
					<th class="num">Zeile</th>
					{#each mappedFields as field (field.name)}
						<th>{field.label}</th>
					{/each}
					<th>Ergebnis</th>
				</tr>
			</thead>
			<tbody>
				{#each preview.rows as row (row.row)}
					<tr class:skipped={row.reason !== undefined}>
						<td class="num">{row.row}</td>
						{#each mappedFields as field (field.name)}
							<td>{row.values[field.name]}</td>
						{/each}
						<td>{row.reason ?? 'ok'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<form method="POST" action="?/preview" enctype="multipart/form-data" class="card" use:enhance>
		<Field label="Art der Daten" error={errors?.kind}>
			<select name="kind" required>
				{#each data.kinds as kind (kind)}
					<option value={kind} selected={selectedKind === kind}>{data.kindLabels[kind]}</option>
				{/each}
			</select>
		</Field>
		<Field
			label="CSV-Datei"
			error={errors?.file}
			hint="Mit Spaltenüberschriften in der ersten Zeile; Trennzeichen Semikolon, Komma oder Tabulator; höchstens 2 MB."
		>
			<input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" required />
		</Field>
		<div class="form-actions">
			<button type="submit">Vorschau anzeigen</button>
		</div>
	</form>

	<h2>So geht es</h2>
	<ol class="steps">
		<li>Exportiere die Daten aus deiner bisherigen Software als CSV-Datei, eine Datei je Art.</li>
		<li>
			Importiere in dieser Reihenfolge: Objekte und Einheiten, dann Mieter, dann Mietverträge,
			zuletzt Zahlungen. Jede Datei bekommt eine Vorschau mit der Spaltenzuordnung, bevor etwas
			gespeichert wird.
		</li>
		<li>
			Beträge mit Komma (650,00), Datumsangaben als 01.01.2025. Ungültige Zeilen werden übersprungen
			und aufgelistet.
		</li>
	</ol>
	<dl class="details">
		{#each data.kinds as kind (kind)}
			<dt>{data.kindLabels[kind]}</dt>
			<dd>{help[kind]}</dd>
		{/each}
	</dl>
{/if}

<style>
	.mapping {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.5rem 1.5rem;
	}
	.skipped td {
		color: var(--color-danger);
	}
	.steps li {
		margin-bottom: 0.5rem;
	}
</style>
