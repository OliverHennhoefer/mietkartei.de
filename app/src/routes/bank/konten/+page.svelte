<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import FormDialog from '#lib/components/FormDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatIban } from '#lib/domain/bank-matching.ts';
	import { byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const ledgerErrors = $derived(form && 'ledgerErrors' in form ? form.ledgerErrors : undefined);
	const synced = $derived(form && 'synced' in form ? form.synced : undefined);
	// ?neu opens the create dialog; it stays open while the server refuses the input.
	const creating = $derived(
		!data.ownerOnly && page.url.searchParams.has('neu') && !(form && 'created' in form)
	);
	// What the dialog created, named above the list once it has closed.
	let created = $state<string>();
	$effect(() => {
		if (creating) created = undefined;
	});
	const createdName = $derived(created ?? (form && 'created' in form ? form.created : undefined));
	// ?bearbeiten=<id> opens a bank account in its dialog.
	const opened = $derived(
		data.bankAccounts.find((account) => account.id === page.url.searchParams.get('bearbeiten'))
	);

	const sort = new TableSort<PageProps['data']['bankAccounts'][number]>({
		name: byText((account) => account.name),
		iban: byText((account) => account.iban),
		bic: byText((account) => account.bic),
		holder: byText((account) => account.holder),
		ledgerNumber: byText((account) => account.ledgerNumber ?? ''),
		transactions: byNumber((account) => account.transactionCount)
	});

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
	{#if createdName && !creating}
		<p role="status">„{createdName}“ wurde angelegt.</p>
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
						<SortHeader {sort} key="name">Bezeichnung</SortHeader>
						<SortHeader {sort} key="ledgerNumber">Konto-Nr.</SortHeader>
						<SortHeader {sort} key="iban">IBAN</SortHeader>
						<SortHeader {sort} key="bic">BIC</SortHeader>
						<SortHeader {sort} key="holder">Kontoinhaber</SortHeader>
						<SortHeader {sort} key="transactions" class="num">Umsätze</SortHeader>
						{#if data.sync}<th>Bankabruf</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each sort.rows(data.bankAccounts) as account (account.id)}
						<tr>
							<td>
								<a href="?bearbeiten={account.id}" data-sveltekit-reset="false">{account.name}</a>
							</td>
							<td>{account.ledgerNumber ?? '–'}</td>
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

	{#if creating}
		<FormDialog
			title="Bankverbindung anlegen"
			action="?/create"
			submitLabel="Bankverbindung anlegen"
			close="/bank/konten"
			onsaved={(saved) => (created = String(saved?.created ?? ''))}
		>
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
			<Field
				label="Kontonummer in der Buchhaltung (optional)"
				error={errors?.ledgerNumber}
				hint="Das Konto dieser Bankverbindung in deinem Kontenplan, etwa 1200. Der DATEV-Export bucht jeden Umsatz von diesem Konto auf sein Gegenkonto."
			>
				<input
					name="ledgerNumber"
					inputmode="numeric"
					maxlength="20"
					defaultValue={values?.ledgerNumber ?? ''}
					placeholder="z. B. 1200"
					aria-invalid={errors?.ledgerNumber ? 'true' : undefined}
				/>
			</Field>
		</FormDialog>
	{/if}
{/if}

{#if opened}
	{#key opened.id}
		<FormDialog
			title={opened.name}
			action={data.ownerOnly ? undefined : '?/ledger'}
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
			{#if !data.ownerOnly}
				<Field
					label="Kontonummer in der Buchhaltung"
					error={ledgerErrors?.ledgerNumber}
					hint="Das Konto dieser Bankverbindung in deinem Kontenplan, etwa 1200."
				>
					<input
						name="ledgerNumber"
						inputmode="numeric"
						maxlength="20"
						defaultValue={opened.ledgerNumber ?? ''}
						placeholder="z. B. 1200"
					/>
				</Field>
			{/if}
		</FormDialog>
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
