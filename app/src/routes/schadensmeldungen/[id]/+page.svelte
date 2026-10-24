<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import { damageReportStatusLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const report = $derived(data.report);
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values: Record<string, string> = $derived(
		(form && 'values' in form && form.values) || {
			status: data.report.status,
			reply: data.report.reply ?? ''
		}
	);
</script>

<PageHeader
	title={report.title}
	lead={report.lease ? `Mieterportal · ${report.lease.label}` : 'Mieterportal'}
	back={{ href: '/schadensmeldungen', label: 'Alle Schadensmeldungen' }}
/>

<section class="card">
	<div class="badges">
		<Badge tone={report.status === 'done' ? 'success' : 'neutral'}
			>{damageReportStatusLabels[report.status]}</Badge
		>
		{#if report.urgent}<Badge tone="danger">dringend</Badge>{/if}
	</div>
	<dl class="details">
		<dt>Gemeldet</dt>
		<dd>{formatDateTime(report.createdAt)}</dd>
		{#if report.lease}
			<dt>Mietvertrag</dt>
			<dd><a href="/vertraege/{report.lease.id}">{report.lease.label}</a></dd>
		{/if}
		{#if report.location}
			<dt>Ort</dt>
			<dd>{report.location}</dd>
		{/if}
		{#if report.reporterName || report.reporterPhone}
			<dt>Gemeldet von</dt>
			<dd>
				{report.reporterName ?? ''}{report.reporterName && report.reporterPhone ? ', ' : ''}
				{#if report.reporterPhone}<a href="tel:{report.reporterPhone}">{report.reporterPhone}</a
					>{/if}
			</dd>
		{/if}
		{#if report.taskId}
			<dt>Aufgabe</dt>
			<dd><a href="/aufgaben/{report.taskId}">Zur Aufgabe</a></dd>
		{/if}
	</dl>
	<p class="description">{report.description}</p>
</section>

{#if data.photos.length > 0}
	<h2>Fotos</h2>
	<ul class="photos" aria-label="Fotos">
		{#each data.photos as photo (photo.id)}
			<li>
				<a href="/dokumente/{photo.id}/herunterladen?inline=1" target="_blank" rel="noreferrer">
					<img src="/dokumente/{photo.id}/herunterladen?inline=1" alt={photo.name} loading="lazy" />
				</a>
			</li>
		{/each}
	</ul>
{/if}

<h2>Bearbeiten</h2>
<p class="muted">Status und Antwort sehen deine Mieter in ihrem Mieterportal.</p>
<form
	method="POST"
	action="?/update"
	class="card"
	use:enhance={() =>
		async ({ update }) =>
			update({ reset: false })}
>
	<Field label="Status" error={errors?.status}>
		<select name="status">
			{#each Object.entries(damageReportStatusLabels) as [status, label] (status)}
				<option value={status} selected={values.status === status}>{label}</option>
			{/each}
		</select>
	</Field>
	<Field label="Antwort an die Mieter (optional)" error={errors?.reply}>
		<textarea
			name="reply"
			rows="4"
			maxlength="2000"
			placeholder="z. B. Der Installateur kommt am Donnerstag zwischen 8 und 12 Uhr."
			>{values.reply ?? ''}</textarea
		>
	</Field>
	<div class="form-actions">
		<button type="submit">Speichern</button>
		{#if form && 'saved' in form}<p role="status">Gespeichert.</p>{/if}
	</div>
</form>

<div class="toolbar">
	{#if !report.taskId}
		<form method="POST" action="?/task">
			<button type="submit" class="secondary">Als Aufgabe übernehmen</button>
		</form>
	{/if}
	<ConfirmButton
		action="?/delete"
		label="Schadensmeldung löschen"
		message="Schadensmeldung „{report.title}“ mit ihren Fotos wirklich löschen? Die Mieter sehen sie dann nicht mehr."
	/>
</div>

<style>
	.badges {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}
	section.card {
		flex-direction: column;
		align-items: stretch;
	}
	.description {
		white-space: pre-line;
		margin: 0.75rem 0 0;
	}
	.photos {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0.75rem;
	}
	.photos img {
		width: 100%;
		height: 10rem;
		object-fit: cover;
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		display: block;
	}
	.toolbar {
		margin-top: 1.5rem;
	}
	.form-actions p {
		margin: 0;
	}
	textarea {
		resize: vertical;
	}
</style>
