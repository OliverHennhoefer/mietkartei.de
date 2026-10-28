<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { GENERIC_PRESET_ID } from '#lib/domain/bank-matching.ts';
	import { mappingFieldNames } from '#lib/forms/bank.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const preview = $derived(form && 'preview' in form ? form.preview : undefined);
	const result = $derived(form && 'result' in form ? form.result : undefined);
	const accountNames = $derived(
		new Map(data.bankAccounts.map((account) => [account.id, account.name]))
	);

	const mappingLabels: Record<(typeof mappingFieldNames)[number], string> = {
		bookingDate: 'Buchungstag',
		valueDate: 'Valuta (optional)',
		amount: 'Betrag',
		counterpartName: 'Name der Gegenseite (optional)',
		counterpartIban: 'IBAN der Gegenseite (optional)',
		purpose: 'Verwendungszweck (optional)'
	};

	const statusLabels = {
		new: { label: 'Neu', tone: 'success' },
		duplicate: { label: 'Duplikat', tone: 'neutral' },
		rule: { label: 'Regel', tone: 'info' },
		invalid: { label: 'Ungültig', tone: 'danger' }
	} as const;
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Import" tab. -->
<h2 class="visually-hidden">Kontoauszug importieren</h2>

{#if result}
	<Alert tone="success">
		<p>
			Import abgeschlossen: {pluralize(result.imported, 'neuer Umsatz', 'neue Umsätze')},
			{pluralize(result.duplicates, 'Duplikat', 'Duplikate')},
			{result.assigned} per Regel zugeordnet{#if result.invalid > 0}, {pluralize(
					result.invalid,
					'ungültige Zeile',
					'ungültige Zeilen'
				)} übersprungen{/if}.
			<a href="/bank">Zu den offenen Umsätzen</a>
		</p>
	</Alert>
{/if}

{#if data.bankAccounts.length === 0}
	<EmptyState
		title="Noch keine Bankverbindung"
		text="Lege zuerst das Konto an, dessen Umsätze du importieren möchtest."
	>
		<CreateButton href="/bank/konten#bankverbindung-anlegen" label="Bankverbindung anlegen" />
	</EmptyState>
{:else if preview}
	<!-- Step 2: the preview. The file travels back in the hidden field; the mapping with it. -->
	<form method="POST" action="?/commit" class="stack" use:enhance>
		<input type="hidden" name="bankAccountId" value={preview.bankAccountId} />
		<input type="hidden" name="fileName" value={preview.fileName} />
		<input type="hidden" name="content" value={preview.content} />
		<input type="hidden" name="preset" value={preview.preset} />

		<p>
			Datei <strong>{preview.fileName}</strong> für
			<strong>{accountNames.get(preview.bankAccountId) ?? 'unbekanntes Konto'}</strong>:
			{#if preview.presetName}
				Format <strong>{preview.presetName}</strong> erkannt.
			{:else if preview.mappingError}
				Format nicht erkannt; ordne die Spalten der Datei zu.
			{:else}
				Format nicht erkannt; die Spalten sind nach ihren Namen zugeordnet. Prüfe die Zuordnung.
			{/if}
		</p>

		{#if preview.preset === GENERIC_PRESET_ID}
			<div class="card form">
				{#each mappingFieldNames as field (field)}
					<Field label={mappingLabels[field]}>
						<select name={field}>
							<option value="" selected={!preview.mapping[field]}>– keine Spalte –</option>
							{#each preview.columns as column (column)}
								<option value={column} selected={preview.mapping[field] === column}>
									{column}
								</option>
							{/each}
						</select>
					</Field>
				{/each}
				<div class="form-actions form-wide">
					<button type="submit" class="secondary" formaction="?/preview">
						Vorschau aktualisieren
					</button>
					{#if preview.mappingError}
						<span class="muted">{preview.mappingError}</span>
					{/if}
				</div>
			</div>
		{/if}

		{#if errors?.file}
			<Alert tone="danger"><p>{errors.file}</p></Alert>
		{/if}

		{#if !preview.mappingError}
			<p class="counts" role="status">
				{pluralize(preview.counts.total, 'Zeile', 'Zeilen')}:
				<strong>{preview.counts.new} neu</strong>,
				{pluralize(preview.counts.duplicates, 'Duplikat', 'Duplikate')},
				{preview.counts.rules} per Regel zugeordnet,
				{preview.counts.invalid} ungültig.
			</p>
			<div class="table-wrap">
				<table class="table" aria-label="Vorschau">
					<thead>
						<tr>
							<th class="num">Nr.</th>
							<th>Buchungstag</th>
							<th>Gegenseite</th>
							<th>Verwendungszweck</th>
							<th class="num">Betrag</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each preview.rows as row (row.index)}
							<tr>
								<td class="num">{row.index + 1}</td>
								{#if row.row}
									<td>{formatDate(row.row.bookingDate)}</td>
									<td>{row.row.counterpartName || '–'}</td>
									<td class="purpose">{row.row.purpose || '–'}</td>
									<td class="num"><Money cents={row.row.amount} signed /></td>
								{:else}
									<td colspan="4" class="muted">{row.reason}</td>
								{/if}
								<td>
									<Badge tone={statusLabels[row.status].tone}
										>{statusLabels[row.status].label}</Badge
									>
									{#if row.status === 'rule' && row.leaseLabel}
										<span class="small">→ {row.leaseLabel}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if preview.hiddenRows > 0}
				<p class="muted">
					{preview.hiddenRows} weitere Zeilen werden hier nicht angezeigt, aber importiert.
				</p>
			{/if}
			<div class="toolbar">
				<button type="submit">Importieren</button>
				<a href="/bank/import">Abbrechen</a>
			</div>
		{/if}
	</form>
{:else}
	<!-- Step 1: choose the account and the file. -->
	<form method="POST" action="?/preview" class="card" enctype="multipart/form-data" use:enhance>
		<Field label="Bankverbindung" error={errors?.bankAccountId}>
			<select name="bankAccountId" aria-invalid={errors?.bankAccountId ? 'true' : undefined}>
				{#each data.bankAccounts as account (account.id)}
					<option value={account.id} selected={values?.bankAccountId === account.id}>
						{account.name}
					</option>
				{/each}
			</select>
		</Field>
		<Field
			label="Kontoauszug"
			error={errors?.file}
			hint="Am besten als camt.053 (XML, auch mehrere als ZIP), das bietet jede Bank im Online-Banking an. CSV-Exporte von Sparkasse, Volksbank, ING, DKB und comdirect werden ebenfalls erkannt, andere CSV-Dateien ordnest du per Spalte zu."
		>
			<input
				type="file"
				name="file"
				accept=".csv,.xml,.zip,text/csv,text/plain,text/xml,application/xml,application/zip"
				required
			/>
		</Field>
		<div class="form-actions form-wide">
			<button type="submit">Datei prüfen</button>
		</div>
	</form>
{/if}

<style>
	.purpose {
		max-width: 28rem;
		overflow-wrap: anywhere;
	}
	.counts {
		margin: 0;
	}
</style>
