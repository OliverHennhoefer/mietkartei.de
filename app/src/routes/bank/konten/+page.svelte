<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import { formatIban } from '#lib/domain/bank-matching.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const message = $derived(form && 'message' in form ? form.message : undefined);
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Konten" tab. -->
<h2>Bankverbindungen</h2>

{#if data.ownerOnly}
	<p>Bankverbindungen sind nur für Vermieter sichtbar, nicht für Mitverwalter.</p>
{:else}
	{#if message}
		<Alert tone="danger"><p>{message}</p></Alert>
	{/if}
	{#if form && 'deleted' in form}
		<Alert tone="success"><p>Die Bankverbindung wurde gelöscht.</p></Alert>
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
						<th class="actions"><span class="visually-hidden">Aktionen</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.bankAccounts as account (account.id)}
						<tr>
							<td>{account.name}</td>
							<td class="iban">{formatIban(account.iban)}</td>
							<td>{account.bic ?? '–'}</td>
							<td>{account.holder}</td>
							<td class="num">{account.transactionCount}</td>
							<td class="actions">
								<ConfirmButton
									action="?/delete"
									label="Löschen"
									message="Bankverbindung „{account.name}“ mit allen importierten Umsätzen löschen?"
								>
									<input type="hidden" name="id" value={account.id} />
								</ConfirmButton>
							</td>
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
		<Field label="BIC (optional)" error={errors?.bic}>
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

<style>
	.iban {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
