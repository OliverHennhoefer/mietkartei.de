<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Field from '#lib/components/Field.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatCentsSigned } from '#lib/money.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const ready = $derived(!!data.numbers.advisorNumber && !!data.numbers.clientNumber);
	const query = $derived(`?von=${data.period.from}&bis=${data.period.to}`);

	const reasons = {
		'no-ledger-number': 'Die Bankverbindung hat keine Kontonummer.',
		'no-contra-account': 'Ohne Gegenkonto gebucht.',
		'no-contra-number': 'Das Gegenkonto hat keine Nummer.'
	} as const;
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "DATEV" tab. -->
<h2 class="visually-hidden">DATEV-Export</h2>
<p class="muted">
	Der DATEV-Buchungsstapel enthält die zugeordneten Umsätze eines Zeitraums, gebucht von der
	Kontonummer der Bankverbindung auf das Gegenkonto. Dein Steuerberater liest ihn in DATEV ein.
	Mieten erscheinen getrennt nach Kaltmiete und Nebenkosten.
</p>

<h2>Beraternummer und Mandantennummer</h2>
<form
	method="POST"
	action="?/numbers"
	class="card"
	use:enhance={() =>
		({ update }) =>
			update({ reset: false })}
>
	<Field label="Beraternummer" error={errors?.advisorNumber} hint="Von deinem Steuerberater.">
		<input
			name="advisorNumber"
			inputmode="numeric"
			maxlength="7"
			defaultValue={values?.advisorNumber ?? data.numbers.advisorNumber ?? ''}
			aria-invalid={errors?.advisorNumber ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Mandantennummer" error={errors?.clientNumber}>
		<input
			name="clientNumber"
			inputmode="numeric"
			maxlength="5"
			defaultValue={values?.clientNumber ?? data.numbers.clientNumber ?? ''}
			aria-invalid={errors?.clientNumber ? 'true' : undefined}
			required
		/>
	</Field>
	<div class="form-actions form-wide">
		<button type="submit" class="secondary">Speichern</button>
	</div>
	{#if form && 'saved' in form}
		<p class="form-actions form-wide" role="status">Gespeichert.</p>
	{/if}
</form>

<h2>Zeitraum</h2>
<form method="GET" class="card" data-sveltekit-keepfocus>
	<Field label="Von">
		<input type="date" name="von" value={data.period.from} required />
	</Field>
	<Field label="Bis">
		<input type="date" name="bis" value={data.period.to} required />
	</Field>
	<div class="form-actions form-wide">
		<button type="submit" class="secondary">Anzeigen</button>
	</div>
</form>

{#if data.period.error}
	<Alert tone="danger"><p>{data.period.error}</p></Alert>
{:else if data.summary}
	<div class="toolbar">
		<strong>
			{pluralize(data.summary.bookings, 'Buchung', 'Buchungen')} vom {formatDate(data.period.from)}
			bis {formatDate(data.period.to)}
		</strong>
		{#if ready && data.summary.bookings > 0}
			<a class="button" href="/bank/datev/export{query}" download>
				<Icon name="download" size={14} /> Buchungsstapel herunterladen
			</a>
		{/if}
	</div>
	{#if !ready}
		<p class="muted">
			Trage oben Beraternummer und Mandantennummer ein, dann kannst du ihn herunterladen.
		</p>
	{/if}
	{#if data.summary.uneven.length > 0}
		<Alert tone="warning">
			<p>
				DATEV erwartet Kontonummern mit {data.summary.accountLength} Stellen. Diese haben eine andere
				Länge: {data.summary.uneven.join(', ')}.
			</p>
		</Alert>
	{/if}
	{#if data.summary.skipped.length > 0}
		<h2>Nicht im Stapel</h2>
		<p class="muted">
			Diese zugeordneten Umsätze fehlen, weil eine Kontonummer fehlt. Ergänze sie unter
			<a href="/bank/konten">Konten</a> oder <a href="/bank/gegenkonten">Gegenkonten</a>, oder öffne
			den Umsatz und ordne ihn neu zu.
		</p>
		<div class="table-wrap">
			<table class="table" aria-label="Nicht im Stapel">
				<thead>
					<tr>
						<th>Datum</th>
						<th>Name</th>
						<th>Konto</th>
						<th class="amount">Betrag</th>
						<th>Grund</th>
					</tr>
				</thead>
				<tbody>
					{#each data.summary.skipped as row (row.id)}
						<tr>
							<td>{formatDate(row.date)}</td>
							<td><a href="/bank?umsatz={row.id}">{row.counterpartName || 'Umsatz'}</a></td>
							<td>{row.bankAccount}</td>
							<td class="amount">{formatCentsSigned(row.amount)}</td>
							<td>{reasons[row.reason]}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

<style>
	.amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
