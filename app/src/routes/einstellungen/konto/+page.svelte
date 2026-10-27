<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { RESET_CONFIRMATION } from '#lib/forms/auth.ts';
	import { PRIVACY_POLICY_URL } from '#lib/legal.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<!-- Deleting and leaving both ask for the password again. -->
{#snippet passwordForm(action: 'delete' | 'leave', label: string)}
	<form method="POST" action="?/{action}" class="form" use:enhance>
		<label>
			Passwort
			<input
				name="password"
				type="password"
				autocomplete="current-password"
				maxlength="200"
				aria-invalid={form?.errors?.password ? 'true' : undefined}
				required
			/>
			{#if form?.errors?.password}<span class="error">{form.errors.password}</span>{/if}
		</label>
		<div class="form-actions">
			<button type="submit" class="danger">{label}</button>
		</div>
	</form>
{/snippet}

<PageHeader title="Konto" />

{#if PRIVACY_POLICY_URL}
	<p class="muted">
		Welche Daten mietkartei speichert, bei welchen Dienstleistern und wie lange, steht in der
		<a href={PRIVACY_POLICY_URL}>Datenschutzerklärung</a>.
	</p>
{/if}

{#if data.canLoadDemo}
	<section class="card demo" aria-labelledby="demodaten">
		<h2 id="demodaten">Demodaten</h2>
		<p>
			Probier mietkartei mit einem kleinen Beispielbestand aus: zwei Objekte, fünf Mietverträge,
			zwei Jahre Mietzahlungen, ein Bankkonto mit offenen Umsätzen, Belege des Vorjahres und zwei
			Aufgaben. Das geht nur, solange dein Konto noch kein Objekt hat. Wenn du fertig bist, setzt du
			das Konto unten auf Werkseinstellungen zurück und fängst neu an.
		</p>
		{#if form?.demoFailed}
			<Alert tone="danger"><p>{form.demoFailed}</p></Alert>
		{/if}
		<form method="POST" action="?/demo" use:enhance>
			<button type="submit">Demodaten anlegen</button>
		</form>
	</section>
{/if}

{#if form?.failed}
	<Alert tone="danger"><p>{form.failed}</p></Alert>
{/if}

{#if data.isOwner}
	<section class="card danger-zone reset" aria-labelledby="zuruecksetzen">
		<h2 id="zuruecksetzen">Auf Werkseinstellungen zurücksetzen</h2>
		<p>
			Das löscht alle Daten deines Kontos endgültig: Objekte, Einheiten, Mieter, Mietverträge,
			Zahlungen, Bankumsätze, Belege, Abrechnungen, Aufgaben, Dokumente und das Protokoll. Dein
			Konto bleibt bestehen, ebenso deine Anmeldung, die weiteren Zugänge mit ihren Rollen, die
			API-Schlüssel, dein Absender und dein Abo. Lade vorher den
			<a href="/einstellungen/export">Export</a> herunter.
		</p>
		{#if form?.resetFailed}
			<Alert tone="danger"><p>{form.resetFailed}</p></Alert>
		{/if}
		<form method="POST" action="?/reset" class="form" use:enhance>
			<label>
				Tippe {RESET_CONFIRMATION} zur Bestätigung
				<input
					name="confirmation"
					autocomplete="off"
					spellcheck="false"
					maxlength="50"
					aria-invalid={form?.resetErrors?.confirmation ? 'true' : undefined}
					required
				/>
				{#if form?.resetErrors?.confirmation}
					<span class="error">{form.resetErrors.confirmation}</span>
				{/if}
			</label>
			<label>
				Passwort
				<input
					name="password"
					type="password"
					autocomplete="current-password"
					maxlength="200"
					aria-invalid={form?.resetErrors?.password ? 'true' : undefined}
					required
				/>
				{#if form?.resetErrors?.password}
					<span class="error">{form.resetErrors.password}</span>
				{/if}
			</label>
			<div class="form-actions">
				<button type="submit" class="danger">Alle Daten löschen</button>
			</div>
		</form>
	</section>
{/if}

<section class="card danger-zone" aria-labelledby="konto-loeschen">
	<h2 id="konto-loeschen">Konto löschen</h2>
	{#if data.isOwner}
		<p>
			Das löscht dein Konto mit allen Objekten, Mietern, Mietverträgen, Zahlungen, Abrechnungen und
			Dokumenten endgültig, auch alle weiteren Zugänge. Lade vorher den
			<a href="/einstellungen/export">Export</a> herunter.
		</p>
		{#if data.subscriptionRuns}
			<p>Dein Abo wird dabei sofort gekündigt; danach bucht Stripe nichts mehr ab.</p>
		{/if}
		{@render passwordForm('delete', 'Konto endgültig löschen')}
	{:else}
		<p class="muted">Nur der Vermieter kann das Konto löschen.</p>
	{/if}
</section>

{#if !data.isOwner}
	<section class="card danger-zone leave" aria-labelledby="konto-verlassen">
		<h2 id="konto-verlassen">Konto verlassen</h2>
		<p>
			Das beendet deinen Zugang zu diesem Konto. Die Daten des Kontos bleiben, du kannst dich aber
			nicht mehr anmelden, bis der Vermieter dich wieder einlädt.
		</p>
		{@render passwordForm('leave', 'Konto verlassen')}
	</section>
{/if}

<style>
	.demo {
		max-width: 45rem;
		margin-bottom: 1.5rem;
	}
	.demo h2 {
		margin: 0 0 0.75rem;
	}
	.demo p {
		margin: 0 0 1.25rem;
	}
	.leave {
		margin-top: 1.5rem;
	}
	.reset {
		margin-bottom: 1.5rem;
	}
	.danger-zone {
		max-width: 45rem;
		border-color: var(--color-danger-border);
		border-left: 3px solid var(--color-danger);
	}
	.danger-zone h2 {
		margin: 0 0 0.75rem;
		color: var(--color-danger);
	}
	.danger-zone p {
		margin: 0 0 1.25rem;
	}
	.danger-zone .form-actions button {
		border-color: var(--color-danger-border);
	}
	.danger-zone .form-actions button:hover {
		background: var(--color-danger-subtle);
	}
</style>
