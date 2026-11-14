<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import FormSection from '#lib/components/FormSection.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import SelfDisclosureFields from '#lib/components/SelfDisclosureFields.svelte';
	import { formatDate, formatDateTime } from '#lib/dates.ts';
	import { burdenTone, RETENTION_MONTHS } from '#lib/domain/applicants.ts';
	import { formatNumber } from '#lib/format.ts';
	import { applicantStatusLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const applicant = $derived(data.applicant);
	const letting = $derived(data.letting);
	const name = $derived(`${applicant.firstName} ${applicant.lastName}`);
	const base = $derived(`/vermietung/${letting.id}/interessenten/${applicant.id}`);
	const viewer = $derived(data.role === 'viewer');
	const editable = $derived(!letting.closedAt && !viewer);
	const decided = $derived(
		applicant.status !== 'accepted' && ['rejected', 'withdrawn'].includes(applicant.status)
	);
	const undecided = $derived(
		['new', 'viewing', 'applied', 'shortlisted'].includes(applicant.status)
	);
	const values = $derived<Record<string, string>>(
		(form && 'values' in form ? form.values : undefined) ?? data.values
	);
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const statuses = ['new', 'viewing', 'applied', 'shortlisted', 'rejected', 'withdrawn'] as const;
	const greeting = $derived(
		applicant.salutation === 'Frau'
			? `Sehr geehrte Frau ${applicant.lastName}`
			: applicant.salutation === 'Herr'
				? `Sehr geehrter Herr ${applicant.lastName}`
				: `Guten Tag ${name}`
	);

	function mailto(subject: string, body: string): string {
		return `mailto:${encodeURIComponent(applicant.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	}

	const linkMail = $derived(
		form && 'linkUrl' in form
			? mailto(
					`Mieterselbstauskunft für ${letting.unit.name}`,
					`${greeting},\n\nvielen Dank für Ihr Interesse an der Wohnung ${letting.unit.name}, ${letting.property.name}. Bitte füllen Sie die Mieterselbstauskunft über diesen Link aus:\n\n${form.linkUrl}\n\nDer Link gilt bis zum ${form.linkExpires}.\n\nMit freundlichen Grüßen\n${data.landlordName}`
				)
			: ''
	);
	const rejectionMail = $derived(
		mailto(
			`Ihre Anfrage zur Wohnung ${letting.unit.name}`,
			`${greeting},\n\nvielen Dank für Ihr Interesse an der Wohnung ${letting.unit.name}, ${letting.property.name}. Leider haben wir uns für eine andere Bewerbung entschieden.\n\nIhre Angaben löschen wir spätestens ${RETENTION_MONTHS} Monate nach dieser Absage.\n\nMit freundlichen Grüßen\n${data.landlordName}`
		)
	);

	const linkUrl = $derived(form && 'linkUrl' in form ? (form.linkUrl ?? '') : '');
	let copied = $state(false);
	async function copy(url: string) {
		await navigator.clipboard.writeText(url);
		copied = true;
	}
</script>

<PageHeader
	title={name}
	back={{ href: `/vermietung/${letting.id}`, label: `Neuvermietung ${letting.unit.name}` }}
/>

{#if form && 'message' in form}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{/if}
{#if form && 'saved' in form}
	<Alert tone="success"><p>Die Angaben sind gespeichert.</p></Alert>
{/if}

<div class="card">
	<dl class="details">
		<dt>Status</dt>
		<dd>
			<Badge
				tone={applicant.status === 'accepted' ? 'success' : decided ? 'neutral' : 'info'}
				icon={false}>{applicantStatusLabels[applicant.status]}</Badge
			>
			{#if applicant.decidedOn}<span class="muted small"
					>seit {formatDate(applicant.decidedOn)}</span
				>{/if}
		</dd>
		{#if data.deletesOn}
			<dt>Löschung</dt>
			<dd>
				Wird am {formatDate(data.deletesOn)} automatisch gelöscht.
			</dd>
		{/if}
		{#if applicant.tenantId}
			<dt>Mieter</dt>
			<dd><a href="/mieter/{applicant.tenantId}">Zum Mieter {name}</a></dd>
		{/if}
		<dt>Warmmiete</dt>
		<dd>
			<Money
				cents={letting.baseRent + letting.operatingCostPrepayment + letting.heatingCostPrepayment}
			/>
			{#if data.burden !== null}
				· Mietbelastung <Badge tone={burdenTone(data.burden)} icon={false}
					>{formatNumber(data.burden * 100, 0)} %</Badge
				>
			{/if}
		</dd>
		{#if applicant.disclosureSubmittedAt}
			<dt>Selbstauskunft</dt>
			<dd>über den Link erhalten am {formatDateTime(applicant.disclosureSubmittedAt)}</dd>
		{/if}
	</dl>
</div>

<div class="toolbar">
	<PreviewLink href="{base}/selbstauskunft" title="Selbstauskunft {name}"
		>Selbstauskunft als PDF</PreviewLink
	>
	{#if applicant.email}<a href="mailto:{applicant.email}">{applicant.email}</a>{/if}
	{#if applicant.phone}<a href="tel:{applicant.phone}">{applicant.phone}</a>{/if}
</div>

{#if editable && undecided}
	<h2>Entscheidung</h2>
	<div class="card decision">
		<p>
			Mit der Zusage legt mietkartei {name}{applicant.coFirstName && applicant.coLastName
				? ` und ${applicant.coFirstName} ${applicant.coLastName}`
				: ''} als Mieter an und öffnet den Mietvertrag mit Miete, Kaution und Einheit dieser Neuvermietung.
			Alle anderen offenen Interessenten bekommen den Status Absage.
		</p>
		<div class="toolbar">
			<ConfirmButton
				action="?/accept"
				label="Zusage geben und Mietvertrag anlegen"
				tone="primary"
				message="Zusage an {name}? Alle anderen offenen Interessenten bekommen den Status Absage."
			/>
			<form method="POST" action="?/status" use:enhance class="inline-form">
				<label class="inline">
					<span class="visually-hidden">Status</span>
					<select name="status">
						{#each statuses as status (status)}
							<option value={status} selected={applicant.status === status}
								>{applicantStatusLabels[status]}</option
							>
						{/each}
					</select>
				</label>
				<button type="submit" class="secondary">Status ändern</button>
			</form>
		</div>
		{#if applicant.email}
			<p class="muted small">
				Absagen verschickst du selbst: <a href={rejectionMail}>Absage als E-Mail vorbereiten</a>.
			</p>
		{/if}
	</div>

	<h2>Selbstauskunft per Link</h2>
	<div class="card">
		<p>
			Über einen geheimen Link füllt {name} die Selbstauskunft selbst aus, ohne Konto. Du schickst den
			Link selbst, etwa per E-Mail oder Messenger; er gilt 14 Tage und lässt sich einmal absenden.
		</p>
		{#if form && 'linkUrl' in form}
			<Alert tone="success">
				<p>
					Der Link gilt bis zum {form.linkExpires}. Er wird nur jetzt angezeigt; kopiere ihn gleich.
				</p>
				<p>
					<input class="link" readonly value={form.linkUrl} aria-label="Link zur Selbstauskunft" />
				</p>
				<div class="toolbar">
					<button type="button" class="secondary" onclick={() => copy(linkUrl)}
						>{copied ? 'Kopiert' : 'Link kopieren'}</button
					>
					{#if applicant.email}<a class="button secondary" href={linkMail}>Als E-Mail vorbereiten</a
						>{/if}
				</div>
			</Alert>
		{:else if data.link.active && data.link.expiresAt}
			<p class="muted">
				{data.link.submittedAt
					? `Eingegangen am ${formatDateTime(data.link.submittedAt)}.`
					: `Ein Link ist offen bis zum ${formatDate(data.link.expiresAt.toISOString().slice(0, 10))}.`}
			</p>
		{/if}
		<div class="toolbar">
			<form method="POST" action="?/link" use:enhance>
				<button type="submit">{data.link.active ? 'Neuen Link erstellen' : 'Link erstellen'}</button
				>
			</form>
			{#if data.link.active}
				<form method="POST" action="?/revoke" use:enhance>
					<button type="submit" class="secondary">Link sperren</button>
				</form>
			{/if}
		</div>
	</div>
{/if}

<h2>Nachweise</h2>
<p class="muted">
	Lass dir Nachweise zeigen und hake sie hier ab; mietkartei speichert nur den Tag, keine Kopie.
	Einkommens- und Bonitätsnachweise brauchst du erst von dem Interessenten, dem du die Wohnung geben
	möchtest.
</p>
<ul class="proofs card">
	{#each data.proofs as proof (proof.key)}
		<li>
			<form method="POST" action="?/proof" use:enhance>
				<input type="hidden" name="key" value={proof.key} />
				<input type="hidden" name="shown" value={proof.on ? '0' : '1'} />
				<button
					type="submit"
					class="secondary small"
					disabled={!editable}
					aria-pressed={proof.on ? 'true' : 'false'}>{proof.on ? '✓' : '○'}</button
				>
			</form>
			<div>
				<strong>{proof.label}</strong>
				{#if proof.on}<span class="muted small">vorgelegt am {formatDate(proof.on)}</span>{/if}
				<p class="muted small">{proof.hint}</p>
			</div>
		</li>
	{/each}
</ul>

<h2>Angaben</h2>
<form method="POST" action="?/update" class="card" use:enhance>
	<fieldset disabled={!editable}>
		<SelfDisclosureFields {values} {errors} requiresWbs={letting.requiresWbs} />
		<FormSection
			title="Deine Notizen"
			description="Nur für dich; steht nicht auf der Selbstauskunft."
		>
			<Field label="Besichtigung" error={errors?.viewingAt}>
				<input name="viewingAt" type="datetime-local" defaultValue={values.viewingAt ?? ''} />
			</Field>
			<Field label="Bewertung" error={errors?.rating}>
				<select name="rating">
					<option value="" selected={!values.rating}>keine</option>
					{#each [5, 4, 3, 2, 1] as stars (stars)}
						<option value={String(stars)} selected={values.rating === String(stars)}
							>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</option
						>
					{/each}
				</select>
			</Field>
			<Field label="Notiz" error={errors?.notes}>
				<textarea name="notes">{values.notes ?? ''}</textarea>
			</Field>
		</FormSection>
		{#if editable}
			<div class="form-actions form-wide">
				<button type="submit">Speichern</button>
			</div>
		{/if}
	</fieldset>
</form>

{#if !viewer}
	<h2>Interessent löschen</h2>
	<p class="muted">
		Löscht {name} mit der Selbstauskunft sofort. Ohne dein Zutun geschieht das {RETENTION_MONTHS} Monate
		nach einer Absage.
	</p>
	<ConfirmButton
		action="?/delete"
		label="Interessent löschen"
		message="{name} endgültig löschen?"
	/>
{/if}

<style>
	.proofs {
		list-style: none;
		display: grid;
		gap: 1rem;
	}
	.proofs li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem;
		align-items: start;
	}
	.proofs p {
		margin: 0.25rem 0 0;
	}
	.link {
		width: 100%;
		font-family: var(--font-mono, monospace);
	}
	.inline-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
</style>
