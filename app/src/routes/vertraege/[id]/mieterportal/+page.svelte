<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import DamageReportList from '#lib/components/DamageReportList.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const created = $derived(form && 'created' in form ? form.created : undefined);
	let copied = $state(false);

	async function copy() {
		if (!created) return;
		await navigator.clipboard.writeText(created);
		copied = true;
	}
</script>

<!-- The heading and tab bar come from +layout.svelte; this page is the "Mieterportal" tab. -->
<h2>Mieterportal</h2>
<p class="muted">
	Über einen persönlichen Link melden deine Mieter Schäden mit Fotos und sehen, wie weit ihre
	Meldungen sind. Sie brauchen dafür kein Konto. Im Portal stehen nur die Einheit, deine
	Absenderangabe und die Meldungen dieses Vertrags, keine Beträge oder Dokumente.
</p>

{#if form && 'message' in form}
	<p class="error" role="alert">{form.message}</p>
{/if}
{#if form && 'sentTo' in form && form.sentTo}
	<p role="status">Der Link wurde an {form.sentTo.join(', ')} geschickt.</p>
{/if}
{#if form && 'revoked' in form}
	<p role="status">Der Link ist gesperrt.</p>
{/if}

<section class="card link">
	{#if created}
		<p>
			<strong>Neuer Link.</strong> Kopiere ihn jetzt: Er wird aus Sicherheitsgründen nur dieses eine Mal
			angezeigt. Ein früherer Link gilt nicht mehr.
		</p>
		<div class="copy">
			<input
				readonly
				value={created}
				aria-label="Link zum Mieterportal"
				onfocus={(event) => event.currentTarget.select()}
			/>
			<button type="button" class="secondary" onclick={copy}
				>{copied ? 'Kopiert' : 'Kopieren'}</button
			>
		</div>
	{:else if data.link}
		<p>Der Link ist aktiv seit {formatDate(dayOf(data.link.createdAt))}.</p>
	{:else}
		<p>Für diesen Mietvertrag gibt es noch keinen Link.</p>
	{/if}
	<div class="actions">
		{#if data.recipients.length > 0}
			<form method="POST" action="?/send" use:enhance>
				<button type="submit"
					>{data.link ? 'Neuen Link per E-Mail schicken' : 'Link per E-Mail schicken'}</button
				>
			</form>
		{/if}
		<form method="POST" action="?/create" use:enhance>
			<button type="submit" class={data.recipients.length > 0 ? 'secondary' : undefined}
				>{data.link ? 'Neuen Link erzeugen' : 'Link erzeugen'}</button
			>
		</form>
		{#if data.link}
			<ConfirmButton
				action="?/revoke"
				label="Link sperren"
				message="Den Link sperren? Die Mieter können das Portal dann nicht mehr öffnen, bis du einen neuen Link erzeugst."
			/>
		{/if}
	</div>
	<p class="muted small">
		{#if data.recipients.length > 0}
			Die E-Mail geht an {data.recipients.join(', ')}.
		{:else}
			Hinterlege bei einem Mieter eine E-Mail-Adresse, um den Link direkt zu verschicken.
		{/if}
		Ein neuer Link ersetzt den alten.
	</p>
</section>

<h2>Schadensmeldungen</h2>
{#if data.reports.length === 0}
	<p class="muted">Zu diesem Mietvertrag wurde noch nichts gemeldet.</p>
{:else}
	<DamageReportList reports={data.reports} label="Schadensmeldungen" showLease={false} />
{/if}

<style>
	.link {
		flex-direction: column;
		align-items: stretch;
		gap: 0.75rem;
	}
	.link p {
		margin: 0;
	}
	.copy {
		display: flex;
		gap: 0.5rem;
	}
	.copy input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
