<script lang="ts">
	import { enhance } from '$app/forms';
	import CashflowChart from '#lib/components/CashflowChart.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import Sections from '../Sections.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatCentsPlain } from '#lib/money.ts';
	import { percent } from '../figures';
	import { byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const windowLabel = $derived(
		data.window === 'last12'
			? 'letzte 12 Monate'
			: data.range.end.endsWith('-12-31')
				? String(data.window)
				: `${data.window} bis heute`
	);
	const perMonth = $derived(Math.round(data.totals.cashflow / data.months));

	const steps = $derived(
		[
			{ label: 'Mieteingang', amount: data.totals.received, kind: 'in' as const },
			{ label: 'Bewirtschaftung', amount: data.totals.operating, kind: 'out' as const },
			{ label: 'Zinsen', amount: data.totals.interest, kind: 'out' as const },
			{ label: 'Tilgung', amount: data.totals.repayment, kind: 'saving' as const },
			{ label: 'Darlehensraten', amount: data.totals.unsplit, kind: 'out' as const },
			{ label: 'Cashflow', amount: data.totals.cashflow, kind: 'result' as const }
		].filter((step) => step.kind === 'in' || step.kind === 'result' || step.amount !== 0)
	);

	const hasData = $derived(
		data.totals.received !== 0 ||
			data.totals.operating !== 0 ||
			data.totals.interest !== 0 ||
			data.totals.repayment !== 0 ||
			data.totals.unsplit !== 0
	);
	const missingInterest = $derived(data.properties.some((row) => row.unsplit !== 0));

	const failedFor = $derived(form && 'values' in form ? form.values?.propertyId : undefined);
	const savedFor = $derived(form && 'saved' in form ? form.saved : undefined);
	const amount = (cents: number | null) => (cents === null ? '' : formatCentsPlain(cents));
	const sort = new TableSort<PageProps['data']['properties'][number]>({
		name: byText((row) => row.name),
		gross: byNumber((row) => row.gross),
		net: byNumber((row) => row.net),
		equity: byNumber((row) => row.equity),
		cashflow: byNumber((row) => row.cashflow)
	});
</script>

<PageHeader title="Rendite und Cashflow" />

<Sections />

<form method="GET" class="toolbar filters">
	<label class="inline">
		Zeitraum
		<select name="zeitraum" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
			<option value="" selected={data.window === 'last12'}>letzte 12 Monate</option>
			{#each data.years as year (year)}
				<option value={String(year)} selected={data.window === year}>{year}</option>
			{/each}
		</select>
	</label>
	{#if data.propertyOptions.length > 1}
		<label class="inline">
			Objekt
			<select name="objekt" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				<option value="" selected={!data.propertyId}>alle Objekte</option>
				{#each data.propertyOptions as property (property.id)}
					<option value={property.id} selected={data.propertyId === property.id}>
						{property.name}
					</option>
				{/each}
			</select>
		</label>
	{/if}
	<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
</form>

{#if data.propertyOptions.length === 0}
	<EmptyState
		title="Noch keine Objekte"
		text="Sobald ein Objekt mit Mietverträgen angelegt ist, siehst du hier Rendite und Cashflow."
	>
		<a href="/objekte">Zu den Objekten</a>
	</EmptyState>
{:else}
	<ul class="tiles" aria-label="Rendite {windowLabel}">
		<li class="card tile">
			<span class="value">{percent(data.rates.gross)}</span>
			<span class="label">Bruttomietrendite</span>
			<span class="note">Kaltmiete im Jahr durch Anschaffungskosten</span>
		</li>
		<li class="card tile">
			<span class="value">{percent(data.rates.net)}</span>
			<span class="label">Nettomietrendite</span>
			<span class="note">nach Kosten, die du selbst trägst</span>
		</li>
		<li class="card tile">
			<span class="value">
				{#if data.rates.equity !== null && data.rates.equity > 0}
					<mark>{percent(data.rates.equity)}</mark>
				{:else}
					{percent(data.rates.equity)}
				{/if}
			</span>
			<span class="label">Eigenkapitalrendite</span>
			<span class="note">
				{#if data.rates.ownCapital !== null && data.rates.equity !== null}
					auf <Money cents={data.rates.ownCapital} /> Eigenkapital, nach Zinsen
				{:else if data.rates.ownCapital === null}
					braucht die Darlehenssumme, siehe unten
				{:else}
					braucht die Zinsen der Darlehensraten
				{/if}
			</span>
		</li>
		<li class="card tile">
			<span class="value" class:negative={perMonth < 0}><Money cents={perMonth} signed /></span>
			<span class="label">Cashflow im Monat</span>
			<span class="note">nach Zins und Tilgung, {windowLabel}</span>
		</li>
	</ul>
	{#if data.rates.counted < data.properties.length && data.rates.counted > 0}
		<p class="muted small">
			Die Renditen zählen nur Objekte mit Anschaffungskosten ({data.rates.counted} von {data
				.properties.length}).
		</p>
	{/if}

	<section aria-labelledby="cashflow">
		<h2 id="cashflow">Vom Mieteingang zum Cashflow · {windowLabel}</h2>
		{#if hasData}
			<div class="card">
				<CashflowChart {steps} label="Vom Mieteingang zum Cashflow, {windowLabel}" />
			</div>
			<details class="as-table">
				<summary>Als Tabelle</summary>
				<div class="table-wrap">
					<table class="table">
						<tbody>
							{#each steps as step (step.label)}
								<tr>
									<td>{step.label}</td>
									<td class="number">
										<Money
											cents={step.kind === 'out' || step.kind === 'saving'
												? -step.amount
												: step.amount}
											signed={step.kind !== 'in'}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
			<p class="muted small">
				Zeitraum {formatDate(data.range.start)} bis {formatDate(data.range.end)}. Mieteingang mit
				Nebenkosten-Vorauszahlungen; die umgelegten Kosten stecken in der Bewirtschaftung.
				{#if data.totals.estimatedInterest !== 0}
					Die Zinsen von <Money cents={data.totals.estimatedInterest} /> sind geschätzt: für Jahre ohne
					Zinsbescheinigung gilt der Zinsanteil der Raten aus dem Jahr davor.
				{/if}
				{#if missingInterest}
					Für Darlehensraten ohne Zinsbescheinigung fehlt die Aufteilung in Zins und Tilgung; trag
					die Zinsen im Reiter Steuer des Objekts ein.
				{/if}
			</p>
		{:else}
			<p class="muted">In diesem Zeitraum gibt es keine Zahlungen oder Ausgaben.</p>
		{/if}
	</section>

	<section aria-labelledby="per-property">
		<h2 id="per-property">Je Objekt</h2>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<SortHeader {sort} key="name">Objekt</SortHeader>
						<SortHeader {sort} key="gross" class="num">Brutto</SortHeader>
						<SortHeader {sort} key="net" class="num">Netto</SortHeader>
						<SortHeader {sort} key="equity" class="num">Eigenkapital­rendite</SortHeader>
						<SortHeader {sort} key="cashflow" class="num">Cashflow im Monat</SortHeader>
					</tr>
				</thead>
				<tbody>
					{#each sort.rows(data.properties) as row (row.id)}
						<tr>
							<td><a href="?objekt={row.id}">{row.name}</a></td>
							<td class="number">{percent(row.gross)}</td>
							<td class="number">{percent(row.net)}</td>
							<td class="number">{percent(row.equity)}</td>
							<td class="number" class:negative={row.cashflow < 0}>
								<Money cents={Math.round(row.cashflow / data.months)} signed />
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section aria-labelledby="financing">
		<h2 id="financing">Kaufpreis und Darlehen</h2>
		<p class="muted small">
			Die Anschaffungskosten (Kaufpreis mit Nebenkosten) sind dieselben wie für die AfA im Reiter
			Steuer. Mit der Darlehenssumme ergibt sich dein Eigenkapital.
		</p>
		<ul class="financing">
			{#each data.properties as row (row.id)}
				{@const errors = failedFor === row.id ? form?.errors : undefined}
				{@const values = failedFor === row.id ? form?.values : undefined}
				<li class="card">
					<form method="POST" action="?/financing" use:enhance>
						<input type="hidden" name="propertyId" value={row.id} />
						<strong class="name">{row.name}</strong>
						<label>
							Anschaffungskosten
							<input
								name="acquisitionCost"
								inputmode="decimal"
								defaultValue={values?.acquisitionCost ?? amount(row.acquisitionCost)}
								aria-invalid={errors?.acquisitionCost ? 'true' : undefined}
							/>
							{#if errors?.acquisitionCost}<span class="error">{errors.acquisitionCost}</span>{/if}
						</label>
						<label>
							Darlehenssumme
							<input
								name="loanAmount"
								inputmode="decimal"
								defaultValue={values?.loanAmount ?? amount(row.loanAmount)}
								aria-invalid={errors?.loanAmount ? 'true' : undefined}
							/>
							{#if errors?.loanAmount}<span class="error">{errors.loanAmount}</span>{/if}
						</label>
						<span class="own muted small">
							{#if savedFor === row.id}
								<span role="status">Gespeichert.</span>
							{/if}
							{#if row.ownCapital !== null}
								Eigenkapital <Money cents={row.ownCapital} />
							{/if}
						</span>
						<button type="submit" class="secondary small">Speichern</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.filters {
		margin-bottom: 1rem;
	}
	.tiles {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
		margin: 0 0 0.75rem;
	}
	.tile {
		display: grid;
		gap: 0.125rem;
		align-content: start;
	}
	.tile .value {
		font-size: var(--text-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.tile .label {
		color: var(--color-muted);
		font-size: var(--text-base);
	}
	.tile .note {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--color-muted);
	}
	mark {
		padding: 0 0.2em;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	.negative {
		color: var(--color-danger);
	}
	section {
		margin: 1.5rem 0;
	}
	.as-table {
		margin-top: 0.5rem;
	}
	.number {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.financing {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.financing form {
		display: grid;
		grid-template-columns: minmax(8rem, 1fr) 10rem 10rem minmax(8rem, auto) auto;
		gap: 0.75rem;
		align-items: end;
	}
	.financing label {
		display: grid;
		gap: 0.25rem;
		font-size: var(--text-sm);
	}
	.name {
		align-self: center;
	}
	.own {
		align-self: center;
	}
	@media (max-width: 50rem) {
		.financing form {
			grid-template-columns: 1fr 1fr;
		}
		.name,
		.own {
			grid-column: 1 / -1;
		}
	}
</style>
