<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatIban } from '#lib/domain/bank-matching.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const synced = $derived(form && 'synced' in form ? form.synced : undefined);
	// ?bearbeiten=<id> opens a bank account in its dialog.
	const opened = $derived(
		data.bankAccounts.find((account) => account.id === page.url.searchParams.get('bearbeiten'))
	);

	const dateTime = new Intl.DateTimeFormat('de-DE', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Europe/Berlin'
	});
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Konten" tab. -->
<h2 class="visually-hidden">Bankverbindungen</h2>

{#if data.ownerOnly}
	<p>Bankverbindungen sieht nur der Vermieter des Kontos.</p>
{:else}
	{#if message}
		<Alert tone="danger"><p>{message}</p></Alert>
	{/if}
	{#if form && 'ended' in form}
		<Alert tone="success"><p>Der Bankabruf ist beendet. Die Umsätze bleiben erhalten.</p></Alert>
	{/if}
	{#if synced}
		<Alert tone="success">
			<p>
				Abgerufen: {synced.imported === 1
					? 'ein neuer Umsatz'
					: `${synced.imported} neue Umsätze`}{#if synced.assigned > 0},
					{synced.assigned} per Regel zugeordnet{/if}.
			</p>
		</Alert>
	{/if}
	{#if data.query.abruf === 'ok'}
		<Alert tone="success">
			<p>
				Der Bankabruf ist eingerichtet. Neue Umsätze holt mietkartei, sobald du die Umsätze öffnest.
			</p>
		</Alert>
	{/if}

	{#if data.bankAccounts.length === 0}
		<EmptyState
			title="Noch keine Bankverbindung"
			text="Lege das Konto an, auf dem die Mieten eingehen. Danach kannst du Kontoauszüge importieren."
		/>
	{:else}
		<div class="table-wrap">
			<table class="table" aria-label="Bankverbindungen">
				<thead>
					<tr>
						<th>Bezeichnung</th>
						<th>IBAN</th>
						<th>BIC</th>
						<th>Kontoinhaber</th>
						<th class="num">Umsätze</th>
						{#if data.sync}<th>Bankabruf</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each data.bankAccounts as account (account.id)}
						<tr>
							<td>
								<a href="?bearbeiten={account.id}" data-sveltekit-reset="false">{account.name}</a>
							</td>
							<td class="iban">{formatIban(account.iban)}</td>
							<td>{account.bic ?? '–'}</td>
							<td>{account.holder}</td>
							<td class="num">{account.transactionCount}</td>
							{#if data.sync}
								{@const sync = data.sync[account.id]}
								<td class="sync">
									{#if sync?.active}
										<span>{sync.bank}, freigegeben bis {formatDate(sync.validUntil!)}</span>
										{#if sync.lastSyncedAt}
											<span class="muted small"
												>Zuletzt abgerufen {dateTime.format(new Date(sync.lastSyncedAt))}</span
											>
										{/if}
										{#if sync.lastError}
											<span class="error small">Letzter Abruf fehlgeschlagen: {sync.lastError}</span
											>
										{/if}
										<span class="sync-actions">
											<form method="POST" action="?/sync" use:enhance>
												<input type="hidden" name="id" value={account.id} />
												<button type="submit" class="secondary small">Jetzt abrufen</button>
											</form>
											<a href="/bank/konten/{account.id}/abruf">Erneuern</a>
											<ConfirmButton
												action="?/end"
												label="Beenden"
												message="Bankabruf für „{account.name}“ beenden? Die Umsätze bleiben erhalten."
											>
												<input type="hidden" name="id" value={account.id} />
											</ConfirmButton>
										</span>
									{:else if sync && !sync.pending}
										<span class="error small">Freigabe bei {sync.bank} abgelaufen</span>
										<a href="/bank/konten/{account.id}/abruf">Erneuern</a>
									{:else}
										<a href="/bank/konten/{account.id}/abruf">Einrichten</a>
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<h2>Bankverbindung anlegen</h2>
	<form method="POST" action="?/create" class="card" use:enhance>
		<Field label="Bezeichnung" error={errors?.name}>
			<input
				name="name"
				defaultValue={values?.name ?? ''}
				placeholder="z. B. Mietkonto"
				aria-invalid={errors?.name ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="IBAN" error={errors?.iban}>
			<input
				name="iban"
				autocapitalize="characters"
				spellcheck="false"
				defaultValue={values?.iban ?? ''}
				placeholder="DE00 0000 0000 0000 0000 00"
				aria-invalid={errors?.iban ? 'true' : undefined}
				required
			/>
		</Field>
		<Field
			label="BIC (optional)"
			error={errors?.bic}
			hint="Bleibt das Feld leer, ergänzen wir sie bei deutschen Konten aus dem Bankleitzahlenverzeichnis der Bundesbank."
		>
			<input
				name="bic"
				autocapitalize="characters"
				spellcheck="false"
				defaultValue={values?.bic ?? ''}
				aria-invalid={errors?.bic ? 'true' : undefined}
			/>
		</Field>
		<Field label="Kontoinhaber" error={errors?.holder}>
			<input
				name="holder"
				defaultValue={values?.holder ?? ''}
				aria-invalid={errors?.holder ? 'true' : undefined}
				required
			/>
		</Field>
		<div class="form-actions form-wide">
			<button type="submit">Bankverbindung anlegen</button>
		</div>
		{#if form && 'created' in form}
			<p class="form-actions form-wide" role="status">„{form.created}“ wurde angelegt.</p>
		{/if}
	</form>
{/if}

{#if opened}
	{#key opened.id}
		<EditDialog
			title={opened.name}
			deleteAction="?/delete"
			deleteMessage="Bankverbindung „{opened.name}“ mit allen importierten Umsätzen löschen?"
			close="/bank/konten"
			error={message}
		>
			<input type="hidden" name="id" value={opened.id} />
			<dl class="details">
				<dt>IBAN</dt>
				<dd>{formatIban(opened.iban)}</dd>
				<dt>BIC</dt>
				<dd>{opened.bic ?? '–'}</dd>
				<dt>Kontoinhaber</dt>
				<dd>{opened.holder}</dd>
				<dt>Umsätze</dt>
				<dd>{opened.transactionCount}</dd>
			</dl>
		</EditDialog>
	{/key}
{/if}

<style>
	.sync {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.sync-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.iban {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
