<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import Field from '#lib/components/Field.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import { damageReportStatusLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	// Tenants address their landlord here, so the page says "Sie", unlike the app's "du".
	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	// Photos that were sent but not kept: no image by their bytes, or the landlord's storage is full.
	const missing = $derived(
		form && 'sent' in form ? (form.photosSent ?? 0) - (form.photos ?? 0) : 0
	);
	let sending = $state(false);

	/** The longer side of a photo after shrinking; enough to see a damage, small to send. */
	const MAX_SIDE = 1600;

	/**
	 * Phone photos are several megabytes each; shrunk to JPEG in the browser they fit the upload
	 * limit. A photo the browser cannot read is sent as it is, and the server decides.
	 */
	async function shrink(file: File): Promise<File> {
		try {
			const bitmap = await createImageBitmap(file);
			const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();
			const blob = await new Promise<Blob | null>((done) =>
				canvas.toBlob(done, 'image/jpeg', 0.82)
			);
			if (!blob || blob.size >= file.size) return file;
			const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
			return new File([blob], name, { type: 'image/jpeg' });
		} catch {
			return file;
		}
	}

	const submit: SubmitFunction = async ({ formData }) => {
		sending = true;
		const photos = formData
			.getAll('photos')
			.filter((value): value is File => value instanceof File && value.size > 0);
		formData.delete('photos');
		for (const photo of await Promise.all(photos.map(shrink))) formData.append('photos', photo);
		return async ({ update }) => {
			await update();
			sending = false;
		};
	};

	function tone(status: keyof typeof damageReportStatusLabels) {
		return status === 'done' ? 'success' : status === 'in_progress' ? 'info' : 'neutral';
	}
</script>

<svelte:head>
	<title>Mieterportal | mietkartei</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="portal">
	<h1>Mieterportal</h1>
	<p class="muted">
		{data.unitName} · {data.propertyName}<br />{data.address}<br />Vermieter: {data.landlord}
	</p>

	<h2>Schaden melden</h2>
	<p class="muted">
		Ihre Meldung geht direkt an Ihren Vermieter. In Notfällen wie einem Wasserrohrbruch, Gasgeruch
		oder Stromausfall rufen Sie bitte zusätzlich direkt an.
	</p>
	{#if form && 'sent' in form}
		<p class="card sent" role="status">
			Danke, Ihre Meldung „{form.sent}“ ist eingegangen.
			{#if missing === 1}
				Ein Foto konnte nicht gespeichert werden.
			{:else if missing > 1}
				{missing} Fotos konnten nicht gespeichert werden.
			{/if}
		</p>
	{/if}
	{#if form && 'message' in form}
		<p class="error" role="alert">{form.message}</p>
	{/if}
	<form method="POST" enctype="multipart/form-data" class="card" use:enhance={submit}>
		<Field label="Was ist kaputt?" error={errors?.title}>
			<input
				name="title"
				defaultValue={values?.title ?? ''}
				placeholder="z. B. Wasserhahn tropft"
				maxlength="120"
				aria-invalid={errors?.title ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Wo genau? (optional)" error={errors?.location}>
			<input
				name="location"
				defaultValue={values?.location ?? ''}
				placeholder="z. B. Bad, Waschbecken"
				maxlength="200"
				aria-invalid={errors?.location ? 'true' : undefined}
			/>
		</Field>
		<Field label="Beschreibung" error={errors?.description}>
			<textarea
				name="description"
				rows="5"
				maxlength="4000"
				placeholder="Seit wann, was genau passiert, was Sie schon versucht haben"
				aria-invalid={errors?.description ? 'true' : undefined}
				required>{values?.description ?? ''}</textarea
			>
		</Field>
		<label class="inline">
			<input type="checkbox" name="urgent" checked={values?.urgent === 'on'} />
			Dringend, es entsteht weiterer Schaden oder die Wohnung ist kaum nutzbar
		</label>
		<Field
			label="Fotos (optional, bis zu 3)"
			error={errors?.photos}
			hint="Fotos helfen, den Schaden einzuschätzen."
		>
			<input type="file" name="photos" accept="image/*" multiple />
		</Field>
		<Field label="Ihr Name (optional)" error={errors?.reporterName}>
			<input
				name="reporterName"
				defaultValue={values?.reporterName ?? ''}
				autocomplete="name"
				maxlength="200"
			/>
		</Field>
		<Field
			label="Telefon für Rückfragen (optional)"
			error={errors?.reporterPhone}
			hint="Etwa um einen Termin für Handwerker abzustimmen."
		>
			<input
				name="reporterPhone"
				type="tel"
				defaultValue={values?.reporterPhone ?? ''}
				autocomplete="tel"
				maxlength="50"
			/>
		</Field>
		<div class="form-actions">
			<button type="submit" disabled={sending}
				>{sending ? 'Wird gesendet …' : 'Meldung senden'}</button
			>
		</div>
	</form>

	<h2>Ihre Meldungen</h2>
	{#if data.reports.length === 0}
		<p class="muted">Über diesen Link wurde noch nichts gemeldet.</p>
	{:else}
		<ul class="list" aria-label="Ihre Meldungen">
			{#each data.reports as report (report.id)}
				<li class="card report">
					<div class="head">
						<strong>{report.title}</strong>
						<Badge tone={tone(report.status)}>{damageReportStatusLabels[report.status]}</Badge>
						{#if report.urgent && report.status !== 'done'}<Badge tone="danger">dringend</Badge
							>{/if}
					</div>
					<span class="muted small">
						gemeldet am {formatDate(dayOf(report.createdAt))}{report.location
							? ` · ${report.location}`
							: ''}
					</span>
					{#if report.reply}
						<p class="reply">
							<span class="muted">Antwort des Vermieters:</span><br />{report.reply}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<p class="muted small footnote">
		Dieser Link ist persönlich. Bitte geben Sie ihn nur an Personen weiter, die mit Ihnen in der
		Wohnung leben.
	</p>
</div>

<style>
	.portal {
		max-width: 40rem;
	}
	.sent {
		margin-bottom: 1rem;
	}
	.report {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.reply {
		margin: 0.25rem 0 0;
		white-space: pre-line;
	}
	.footnote {
		margin-top: 2rem;
	}
	textarea {
		resize: vertical;
	}
</style>
