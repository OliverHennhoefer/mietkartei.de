<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FlowChart from '#lib/components/FlowChart.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate, formatMonth } from '#lib/dates.ts';
	import { cappingLimit } from '#lib/domain/forecast.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const points = $derived(
		data.months.map((month) => ({
			key: month.month,
			label: formatMonth(month.month).slice(0, 3),
			title: formatMonth(month.month),
			received: month.rent + month.increases,
			expenses: month.costs,
			net: month.rent + month.increases - month.costs
		}))
	);
	const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
	const cashflow = $derived(sum(data.months.map((month) => month.rent - month.costs)));
	const fromIncreases = $derived(sum(data.months.map((month) => month.increases)));
	const backPayments = $derived(sum(data.settlements.map((row) => Math.max(0, row.balance))));
	const kinds = {
		graduated: 'Staffelmiete',
		indexed: 'Indexmiete',
		comparative: 'Vergleichsmiete'
	} as const;
	const first = $derived(data.months[0]?.month);
	const last = $derived(data.months.at(-1)?.month);
</script>

<PageHeader
	title="Prognose"
	lead="Was die nächsten zwölf Monate bringen, wo die Miete steigen kann und wie die nächste Nebenkostenabrechnung ausfallen dürfte."
/>

{#if data.propertyOptions.length === 0}
	<EmptyState
		title="Noch keine Mietverträge"
		text="Sobald Mietverträge angelegt sind, rechnet diese Seite die nächsten zwölf Monate voraus."
	>
		<a href="/vertraege">Zu den Mietverträgen</a>
	</EmptyState>
{:else}
	{#if data.propertyOptions.length > 1}
		<form method="GET" class="toolbar filters">
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
			<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
		</form>
	{/if}

	<ul class="tiles" aria-label="Prognose">
		<li class="card tile">
			<span class="value" class:negative={cashflow < 0}><Money cents={cashflow} signed /></span>
			<span class="label">Cashflow der nächsten zwölf Monate</span>
			<span class="note">laufende Mieten abzüglich der Kosten im Schnitt</span>
		</li>
		<li class="card tile">
			<span class="value">
				{#if fromIncreases > 0}
					<mark><Money cents={fromIncreases} signed /></mark>
				{:else}
					<Money cents={0} />
				{/if}
			</span>
			<span class="label">aus Indexerhöhungen</span>
			<span class="note">wenn du sie zum frühesten Termin verlangst</span>
		</li>
		<li class="card tile">
			<span class="value" class:negative={backPayments > 0}>
				<Money cents={backPayments} />
			</span>
			<span class="label">erwartete Nachzahlungen</span>
			<span class="note">
				{#if data.settlements.length}
					in der nächsten Nebenkostenabrechnung, geschätzt
				{:else}
					braucht eine freigegebene Abrechnung
				{/if}
			</span>
		</li>
	</ul>

	<section aria-labelledby="months">
		<h2 id="months">Die nächsten zwölf Monate</h2>
		<div class="card">
			<FlowChart {points} label="Erwartete Einnahmen und Ausgaben je Monat" />
		</div>
		<details class="as-table">
			<summary>Als Tabelle</summary>
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Monat</th>
							<th class="number">Miete</th>
							<th class="number">Indexerhöhungen</th>
							<th class="number">Kosten</th>
							<th class="number">Cashflow</th>
						</tr>
					</thead>
					<tbody>
						{#each data.months as month (month.month)}
							<tr>
								<td>{formatMonth(month.month)}</td>
								<td class="number"><Money cents={month.rent} /></td>
								<td class="number"><Money cents={month.increases} /></td>
								<td class="number"><Money cents={month.costs} /></td>
								<td class="number">
									<Money cents={month.rent + month.increases - month.costs} signed />
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
		<p class="muted small">
			{#if first && last}{formatMonth(first)} bis {formatMonth(last)}.{/if}
			Die Miete ist das, was die Mietverträge mit allen freigegebenen Änderungen verlangen, Staffeln eingeschlossen,
			mit Vorauszahlungen. Die Kosten sind der Durchschnitt der letzten zwölf Monate (<Money
				cents={data.monthlyCosts}
			/> im Monat), Darlehensraten eingeschlossen.
		</p>
	</section>

	<section aria-labelledby="increases">
		<h2 id="increases">Mögliche Mieterhöhungen</h2>
		{#if data.increases.length}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Mietvertrag</th>
							<th>Art</th>
							<th>frühestens ab</th>
							<th class="number">Kaltmiete jetzt</th>
							<th class="number">mehr im Monat</th>
						</tr>
					</thead>
					<tbody>
						{#each data.increases as row (row.leaseId)}
							<tr>
								<td><a href="/vertraege/{row.leaseId}/miethoehe">{row.label}</a></td>
								<td>{kinds[row.kind]}</td>
								<td>{formatDate(row.from)}</td>
								<td class="number"><Money cents={row.currentBaseRent} /></td>
								<td class="number">
									{#if row.kind === 'comparative'}bis zu{/if}
									<Money cents={row.increase} signed />
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small">
				Staffelmiete: der nächste vereinbarte Schritt. Indexmiete: nach dem neuesten
				Verbraucherpreisindex, wirksam frühestens ein Jahr nach der letzten Änderung.
				Vergleichsmiete (§ 558 BGB): der Spielraum bis zur Kappungsgrenze von {cappingLimit * 100} % in
				drei Jahren, nur soweit die ortsübliche Vergleichsmiete ihn hergibt; manche Städte haben 15 %.
				Nur die Indexerhöhungen stecken in der Prognose oben.
			</p>
		{:else}
			<p class="muted">Gerade ist keine Mieterhöhung möglich oder vereinbart.</p>
		{/if}
	</section>

	<section aria-labelledby="settlements">
		<h2 id="settlements">Nächste Nebenkostenabrechnung</h2>
		{#if data.settlements.length}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Mietvertrag</th>
							<th class="number">letzte Abrechnung</th>
							<th class="number">erwartet</th>
							<th class="number">Vorauszahlung jetzt</th>
							<th class="number">deckend wären</th>
						</tr>
					</thead>
					<tbody>
						{#each data.settlements as row (row.leaseId)}
							<tr>
								<td><a href="/vertraege/{row.leaseId}/miethoehe">{row.label}</a></td>
								<td class="number">
									{row.lastBalance > 0 ? 'Nachzahlung' : 'Guthaben'}
									<Money cents={Math.abs(row.lastBalance)} />
									<span class="muted small">bis {formatDate(row.lastPeriodEnd)}</span>
								</td>
								<td class="number" class:negative={row.balance > 0}>
									{row.balance > 0 ? 'Nachzahlung' : 'Guthaben'}
									<Money cents={Math.abs(row.balance)} />
								</td>
								<td class="number"><Money cents={row.currentPrepayment} /></td>
								<td class="number">
									{#if row.suggestedPrepayment > row.currentPrepayment}
										<strong><Money cents={row.suggestedPrepayment} /></strong>
									{:else}
										<Money cents={row.suggestedPrepayment} />
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small">
				Geschätzt aus den Kosten der letzten freigegebenen Abrechnung, auf ein Jahr gerechnet, gegen
				die Vorauszahlungen von heute. Steigen die Kosten, fällt die Nachzahlung höher aus. Nach
				einer Abrechnung darfst du die Vorauszahlung angemessen anpassen (§ 560 Abs. 4 BGB).
			</p>
		{:else}
			<p class="muted">
				Für eine Schätzung braucht es eine freigegebene Nebenkostenabrechnung. Sie entsteht unter
				<a href="/betriebskosten/abrechnungen">Betriebskosten</a>.
			</p>
		{/if}
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
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.tile .label {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
	.tile .note {
		margin-top: 0.5rem;
		font-size: 0.85rem;
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
</style>
